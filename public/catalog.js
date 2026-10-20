// Categorias do quadro de equipamentos do contrato, nos mesmos títulos do modelo
// da AOF. Compartilhado entre o navegador (cadastro de produtos) e o PDF, para a
// categoria escolhida no cadastro ser exatamente a coluna impressa no contrato.
// Sem isso a classificação fica por adivinhação a partir do nome do item.
// Funções puras, sem DOM e sem Node, para rodar nos dois lados.
export const EQUIPMENT_CATEGORIES = [
  { id: "sound", label: "Som da festa", title: "EQUIPAMENTOS DE SOM “FESTA”" },
  { id: "dj", label: "DJ", title: "EQUIPAMENTOS DJ FESTA" },
  { id: "light", label: "Iluminação e efeitos", title: "ILUMINAÇÃO E EFEITOS PARA DANÇA" },
  { id: "ceremony", label: "Som da cerimônia", title: "EQUIPAMENTOS DE SOM CERIMÔNIA" },
  { id: "media", label: "Kit mídia (fotos e vídeos)", title: "KIT MÍDIA FOTOS E VÍDEOS" },
  { id: "scenic", label: "Cênicas (iluminação decorativa)", title: "CÊNICAS – ILUMINAÇÃO DECORATIVA" },
  { id: "other", label: "Outros itens", title: "OUTROS ITENS" },
];

// Disposição do quadro no contrato: duas faixas de três colunas, como no modelo.
export const CATEGORY_BANDS = [
  ["sound", "dj", "light"],
  ["ceremony", "media", "scenic"],
];
export const CATEGORY_IDS = EQUIPMENT_CATEGORIES.map((c) => c.id);
export const DEFAULT_CATEGORY = "other";

export const categoryOf = (id) =>
  EQUIPMENT_CATEGORIES.find((c) => c.id === id) || EQUIPMENT_CATEGORIES.at(-1);
export const categoryLabel = (id) => categoryOf(id).label;
export const categoryTitle = (id) => categoryOf(id).title;

/** Quantidade com dois dígitos, como as linhas do quadro do contrato: "02". */
export const qtyLabel = (qty) => String(Math.max(1, Number(qty) || 1)).padStart(2, "0");

/** "02 Caixas de som" — a mesma forma usada na lista de equipamentos em texto. */
export const itemLine = (item) => `${qtyLabel(item.qty)} ${String(item.name || "").trim()}`.trim();

/**
 * Texto da lista de equipamentos a partir dos itens escolhidos, mais as linhas
 * soltas digitadas à mão. É o formato que o orçamento e as telas já usam.
 */
export function equipmentText(items, extras = "") {
  const lines = (items || []).filter((item) => String(item.name || "").trim()).map(itemLine);
  const loose = String(extras || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  return [...lines, ...loose].join("\n");
}

/** Soma dos valores de referência dos itens, para comparar com o preço do pacote. */
export const itemsTotal = (items) =>
  (items || []).reduce((sum, item) => sum + (Number(item.price) || 0) * (Number(item.qty) || 1), 0);

/** Normaliza o que vem do formulário: descarta linhas sem produto e limita a quantidade. */
export function cleanItems(items) {
  return (items || [])
    .map((item) => ({
      productId: item.productId == null || item.productId === "" ? null : Number(item.productId),
      name: String(item.name || "").trim(),
      category: CATEGORY_IDS.includes(item.category) ? item.category : DEFAULT_CATEGORY,
      qty: Math.min(999, Math.max(1, Math.round(Number(item.qty) || 1))),
      price: Number(item.price) || 0,
    }))
    .filter((item) => item.name);
}
