import { CATEGORY_IDS, equipmentText } from "./public/catalog.js";

const key = (value) => String(value || "").normalize("NFKC").trim().toLocaleLowerCase("pt-BR").replace(/\s+/g, " ");
// Apenas os nomes conhecidos do pacote que acompanhava o sistema. Outros nomes
// são preservados e ficam em Outros itens, sem adivinhar seu quadro no contrato.
const knownProducts = [
  ["Caixa de som", "sound", "caixas de som"],
  ["Caixa de grave", "sound", "caixas de grave"],
  ["Microfone sem fio", "sound", "microfones sem fio"],
  ["Notebook DJ", "dj", "notebooks DJ"],
  ["Controladora DJ", "dj"],
  ["Mixer de 2 canais", "dj"],
  ["Moving head", "light", "moving heads"],
  ["Máquina de fumaça", "light", "máquinas de fumaça"],
  ["Torre de treliça", "light", "torres de treliça"],
  ["Transporte e montagem", "other"],
];
const known = new Map();
for (const [name, category, ...aliases] of knownProducts) {
  const product = { name, category, aliases: [name, ...aliases].map(key) };
  for (const alias of product.aliases) known.set(alias, product);
}

/** Extrai uma quantidade inicial sem confundir unidades/modelos com quantidade. */
export function parseLegacyEquipmentLine(value) {
  const line = String(value ?? "").trim();
  const match = line.match(/^(\d{1,3})(?:\s*x\s+|\s*×\s*|\s+)(\S.*)$/i);
  if (!match || Number(match[1]) < 1) return { name: line, qty: 1 };
  const name = match[2].trim();
  // "2 em 1", "12 canais" e nomes que começam com uma medida continuam inteiros.
  if (/^(?:\d|em\s+\d|(?:canal|canais|vias?|polegadas?|watts?|volts?|w|v|gb|tb|hz|mhz|ghz|mm|cm|m)(?=\s|$))/i.test(name))
    return { name: line, qty: 1 };
  return { name, qty: Number(match[1]) };
}

const validProductId = (value) => Number.isSafeInteger(Number(value)) && Number(value) > 0;
const productItem = (product, qty) => ({
  productId: product.id,
  name: product.name,
  category: CATEGORY_IDS.includes(product.category) ? product.category : "other",
  price: Number(product.price) || 0,
  qty: Number(qty),
});

/** Converte somente pacotes; documentos emitidos nunca são regravados. */
export function migratePackageCatalog(db, uid) {
  db.exec("BEGIN IMMEDIATE");
  try {
    const packages = db.prepare("SELECT id,body FROM records WHERE user_id=? AND kind='packages' ORDER BY id").all(uid);
    const products = db.prepare("SELECT id,body FROM records WHERE user_id=? AND kind='products' ORDER BY id").all(uid)
      .map((row) => ({ ...JSON.parse(row.body), id: Number(row.id) }));
    const insert = db.prepare("INSERT INTO records(user_id,kind,body) VALUES(?, 'products', ?)");
    const update = db.prepare("UPDATE records SET body=? WHERE id=? AND user_id=? AND kind='packages'");
    const resolve = (name, category = null, price = 0) => {
      const exact = products.find((product) => key(product.name) === key(name));
      if (exact) return exact;
      const definition = known.get(key(name));
      const alias = definition && products.find((product) => definition.aliases.includes(key(product.name)));
      if (alias) return alias;
      const product = {
        name,
        category: CATEGORY_IDS.includes(category) ? category : definition?.category || "other",
        price: Number(price) || 0,
      };
      const id = Number(insert.run(uid, JSON.stringify(product)).lastInsertRowid);
      const saved = { ...product, id };
      products.push(saved);
      return saved;
    };
    let converted = 0;
    for (const row of packages) {
      const previous = JSON.parse(row.body);
      if (Number(previous.catalogVersion) >= 1) continue;
      const items = Array.isArray(previous.items) ? structuredClone(previous.items) : [];
      // Itens antigos sem vínculo também entram no catálogo, mantendo seu snapshot.
      // IDs de produtos excluídos não são recriados: o pacote conserva o histórico.
      for (const item of items) {
        if (!validProductId(item.productId) && String(item.name || "").trim())
          item.productId = resolve(String(item.name).trim(), item.category, item.price).id;
      }
      const extras = String(previous.equipmentExtra || "");
      const loose = items.length
        ? extras
        : extras.trim() ? extras : String(previous.equipment || "");
      for (const raw of loose.split(/\r?\n/)) {
        const parsed = parseLegacyEquipmentLine(raw);
        if (!parsed.name) continue;
        items.push(productItem(resolve(parsed.name), parsed.qty));
      }
      const next = {
        ...previous,
        catalogVersion: 1,
        items,
        equipmentExtra: "",
        equipment: equipmentText(items),
      };
      if (loose.trim() && !previous.legacyEquipment)
        next.legacyEquipment = {
          equipment: previous.equipment ?? null,
          equipmentExtra: previous.equipmentExtra ?? null,
        };
      update.run(JSON.stringify(next), row.id, uid);
      converted++;
    }
    db.exec("COMMIT");
    return converted;
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

/** Valida vínculos e reconstrói os campos derivados ao salvar um pacote. */
export function preparePackage(db, uid, body, previous = null) {
  if (!Array.isArray(body.items) || !body.items.length)
    throw Error("Adicione pelo menos um produto ao pacote.");
  if (body.items.length > Math.max(200, previous?.items?.length || 0))
    throw Error("Limite de 200 itens por pacote.");
  if (String(body.equipmentExtra || "").trim())
    throw Error("Cadastre os itens em Produtos e selecione-os na composição do pacote.");
  const find = db.prepare("SELECT id,body FROM records WHERE id=? AND user_id=? AND kind='products'");
  const items = body.items.map((item) => {
    if (!validProductId(item?.productId))
      throw Error("Selecione um produto do seu catálogo para cada item do pacote.");
    const qty = Number(item.qty);
    if (!Number.isInteger(qty) || qty < 1 || qty > 999)
      throw Error("Informe uma quantidade inteira de 1 a 999 para cada produto.");
    const prior = previous?.items?.find((saved) =>
      Number(saved.productId) === Number(item.productId) &&
      saved.name === item.name && saved.category === item.category &&
      Number(saved.price || 0) === Number(item.price || 0));
    // Não atualiza silenciosamente nome, quadro ou preço gravados no pacote.
    if (prior) return { ...prior, qty };
    const row = find.get(Number(item.productId), uid);
    if (!row) throw Error("Produto não encontrado no seu catálogo. Selecione outro produto.");
    return productItem({ ...JSON.parse(row.body), id: Number(row.id) }, qty);
  });
  const result = { ...body, catalogVersion: 1, items, equipmentExtra: "", equipment: equipmentText(items) };
  // Backup da conversão pertence ao servidor, não ao formulário.
  delete result.legacyEquipment;
  if (previous?.legacyEquipment) result.legacyEquipment = previous.legacyEquipment;
  return result;
}
