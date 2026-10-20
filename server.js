import express from "express";
import { DatabaseSync } from "node:sqlite";
import { scryptSync, randomBytes, timingSafeEqual } from "node:crypto";
import { spawn } from "node:child_process";
import { join } from "node:path";
import PDFDocument from "pdfkit";
import {
  APP_NAME,
  APP_VERSION,
  dataDir,
  ensureDir,
  packaged,
  readAsset,
} from "./app-env.js";
import { serveAssets } from "./static-assets.js";
import { LOGO_FIELDS, validateLogos } from "./branding.js";
import {
  createDesktopSession,
  desktopRequested,
  reportDesktopError,
  showDesktopNotice,
} from "./desktop-window.js";
import { CATEGORY_IDS, equipmentText } from "./public/catalog.js";
import { QUOTE_TEMPLATES, getQuoteTemplate } from "./public/quote-templates.js";
import { renderQuotePdf } from "./quote-pdf.js";
import { renderContractPdf } from "./contract-pdf.js";
const app = express();
app.disable("x-powered-by");
app.use(express.json({ limit: "1mb" }));
// Banco local, no perfil do usuário quando instalado. Nada sai do computador.
const DATA_DIR = ensureDir(dataDir());
const db = new DatabaseSync(join(DATA_DIR, "app.sqlite"));
let runningServer = null;
let stopping = false;
const desktop = desktopRequested()
  ? createDesktopSession({ onClose: shutdownDesktop })
  : null;
async function shutdownDesktop(reason) {
  if (stopping) return;
  stopping = true;
  const exitCode = reason === "startup-timeout" ? 1 : 0;
  await desktop?.stop();
  let finished = false;
  const finish = () => {
    if (finished) return;
    finished = true;
    try {
      db.exec("PRAGMA wal_checkpoint(TRUNCATE)");
      db.close();
    } catch (error) {
      console.error(error.message);
    }
    process.exit(exitCode);
  };
  if (!runningServer) return finish();
  runningServer.close(finish);
  runningServer.closeIdleConnections?.();
  setTimeout(() => {
    runningServer.closeAllConnections?.();
    finish();
  }, 4000).unref();
}
db.exec(
  `PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS users(id INTEGER PRIMARY KEY, name TEXT, email TEXT UNIQUE, salt TEXT, hash TEXT); CREATE TABLE IF NOT EXISTS sessions(token TEXT PRIMARY KEY,user_id INTEGER,expires INTEGER); CREATE TABLE IF NOT EXISTS records(id INTEGER PRIMARY KEY,user_id INTEGER,kind TEXT,body TEXT);`,
);
const initialClauses = `1. OBJETO E SERVIÇOS\nPrestação de serviços de DJ, sonorização e iluminação no evento e horários descritos neste instrumento, incluindo atendimento, planejamento, transporte, montagem, execução e desmontagem dos equipamentos contratados.\n\n2. ALIMENTAÇÃO\nO contratante disponibilizará alimentação para os profissionais durante o evento.\n\n3. DURAÇÃO E HORAS ADICIONAIS\nO serviço seguirá os horários acordados neste documento. Horas adicionais dependem de disponibilidade, aceite entre as partes e pagamento prévio do valor informado no resumo comercial.\n\n4. LICENÇAS E AUTORIZAÇÕES\nAs responsabilidades por ECAD, ART, licenças e autorizações do espaço deverão ser ajustadas expressamente entre as partes antes da assinatura.\n\n5. PAGAMENTO\nOs valores e vencimentos seguem o plano de pagamento deste documento. Eventual inadimplência será comunicada ao contratante para negociação e regularização.\n\n6. CANCELAMENTO\nEm caso de cancelamento pelo contratante, o modelo comercial prevê multa de 30% do valor total, sujeita à legislação aplicável e à revisão pelas partes. O pedido deverá ser formalizado por escrito.\n\n7. IMPEDIMENTO E FORÇA MAIOR\nEm caso de impedimento, a contratada comunicará o contratante e negociará substituição por profissional equivalente ou devolução dos valores referentes aos serviços não prestados.\n\n8. REMARCAÇÃO\nA remarcação está sujeita à disponibilidade e ao aceite escrito. O modelo comercial prevê taxa de 15%, sujeita à legislação aplicável e à revisão pelas partes.\n\n9. EQUIPAMENTOS E REPERTÓRIO\nOs equipamentos são de uso exclusivo da equipe contratada. Eventuais danos deverão ser apurados e comprovados. O repertório será combinado previamente; não há compromisso de download de músicas durante o evento.\n\n10. ESTRUTURA TÉCNICA\nO espaço deverá disponibilizar área protegida de 6 × 3 metros, alimentação elétrica compatível e mesa de 2,30 metros, ou estrutura previamente acordada com a contratada.\n\n11. MONTAGEM E DESMONTAGEM\nA montagem será planejada com antecedência mínima de 5 horas, conforme acesso ao local. Equipamentos em áreas externas dependem de proteção e condições climáticas seguras. A desmontagem ocorrerá após o encerramento ou conforme ajuste escrito.\n\n12. IMAGEM\nO uso de imagem somente será permitido quando autorizado expressamente no campo específico deste documento.\n\n13. DISPOSIÇÕES FINAIS\nAs partes ajustarão o repertório até 10 dias antes do evento. Alterações deverão ser registradas por escrito. Eventuais conflitos observarão a legislação aplicável e as regras legais de competência.`;
const defaultSettings = {
  company: "AOF Serviços",
  representative: "Abraão Ferreira · DJ Kaio Jansen",
  cnpj: "28.491.743/0001-20",
  email: "aofservicos@hotmail.com",
  phone: "",
  address: "Blumenau · SC",
  pix: "28.491.743/0001-20",
  quoteValidityDays: 15,
  quoteLogoDataUrl: null,
  contractLogoDataUrl: null,
  clauses: initialClauses,
};
const historyEvent = (type, extra = {}) => ({
  at: new Date().toISOString(),
  type,
  ...extra,
});
// Acrescenta um evento ao histórico do documento. Edições seguidas em até
// 30 minutos viram um único registro, para o histórico não encher de "editado".
function withEvent(doc, event) {
  const history = Array.isArray(doc.history) ? [...doc.history] : [];
  const last = history.at(-1);
  if (
    event.type === "edited" &&
    last?.type === "edited" &&
    Date.parse(event.at) - Date.parse(last.at) < 30 * 60000
  )
    history[history.length - 1] = event;
  else history.push(event);
  return history.slice(-100);
}
const stmt = (q, ...a) => db.prepare(q).run(...a);
const get = (q, ...a) => db.prepare(q).get(...a);
const put = (uid, kind, body) =>
  Number(
    stmt(
      "INSERT INTO records(user_id,kind,body) VALUES(?,?,?)",
      uid,
      kind,
      JSON.stringify(body),
    ).lastInsertRowid,
  );
function cookie(req) {
  return req.headers.cookie
    ?.split(";")
    .map((x) => x.trim())
    .find((x) => x.startsWith("session="))
    ?.slice(8);
}
function auth(req, res, next) {
  const s = get(
    "SELECT user_id FROM sessions WHERE token=? AND expires>?",
    cookie(req) || "",
    Date.now(),
  );
  if (!s)
    return res
      .status(401)
      .json({ error: "Entre na sua conta para continuar." });
  req.uid = s.user_id;
  next();
}
const safeUser = (u) => ({ id: u.id, name: u.name, email: u.email });
app.post("/api/register", (req, res) => {
  const { name, email, password } = req.body;
  if (
    !name?.trim() ||
    !/^\S+@\S+\.\S+$/.test(email || "") ||
    typeof password !== "string" ||
    password.length < 10
  )
    return res.status(400).json({
      error:
        "Informe nome, e-mail válido e senha com pelo menos 10 caracteres.",
    });
  if (get("SELECT id FROM users WHERE email=?", email.toLowerCase()))
    return res.status(409).json({ error: "Este e-mail já está cadastrado." });
  const salt = randomBytes(16).toString("hex");
  const uid = Number(
    stmt(
      "INSERT INTO users(name,email,salt,hash) VALUES(?,?,?,?)",
      name.trim(),
      email.toLowerCase(),
      salt,
      scryptSync(password, salt, 64).toString("hex"),
    ).lastInsertRowid,
  );
  put(uid, "settings", defaultSettings);
  // Catálogo inicial já separado pelos quadros do contrato, para o primeiro
  // pacote sair montado a partir de produtos em vez de texto solto.
  const catalogue = [
    { name: "Caixa de som", category: "sound", qty: 2 },
    { name: "Caixa de grave", category: "sound", qty: 2 },
    { name: "Microfone sem fio", category: "sound", qty: 2 },
    { name: "Notebook DJ", category: "dj", qty: 2 },
    { name: "Controladora DJ", category: "dj", qty: 1 },
    { name: "Mixer de 2 canais", category: "dj", qty: 1 },
    { name: "Moving head", category: "light", qty: 4 },
    { name: "Máquina de fumaça", category: "light", qty: 1 },
    { name: "Torre de treliça", category: "light", qty: 2 },
    { name: "Mesa de som da cerimônia", category: "ceremony", qty: 1 },
    { name: "Caixa de som da cerimônia", category: "ceremony", qty: 2 },
    { name: "Luz cênica para ambientação", category: "scenic", qty: 8 },
    { name: "Transporte e montagem", category: "other", qty: 1 },
  ].map(({ name, category, qty }) => ({
    productId: put(uid, "products", { name, category, price: 0 }),
    name,
    category,
    qty,
    price: 0,
  }));
  // Cerimônia e cênicas ficam no catálogo para serem acrescentadas quando houver.
  const items = catalogue.filter(
    (item) => !["ceremony", "scenic"].includes(item.category),
  );
  put(uid, "packages", {
    name: "Pacote 2 · Som & Luz",
    price: 2700,
    description: "DJ, sonorização e iluminação para sua festa",
    items,
    equipmentExtra: "",
    equipment: equipmentText(items),
  });
  login(uid, res);
});
function login(uid, res) {
  const token = randomBytes(32).toString("hex");
  stmt(
    "INSERT INTO sessions VALUES(?,?,?)",
    token,
    uid,
    Date.now() + 7 * 86400000,
  );
  res.setHeader(
    "Set-Cookie",
    `session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=604800${process.env.COOKIE_SECURE === "true" ? "; Secure" : ""}`,
  );
  res.json(safeUser(get("SELECT * FROM users WHERE id=?", uid)));
}
const attempts = new Map();
app.post("/api/login", (req, res) => {
  const key = req.ip,
    a = attempts.get(key) || { count: 0, time: Date.now() };
  if (Date.now() - a.time > 900000) {
    a.count = 0;
    a.time = Date.now();
  }
  if (++a.count > 25)
    return res
      .status(429)
      .json({ error: "Muitas tentativas. Tente novamente em 15 minutos." });
  attempts.set(key, a);
  const { email, password } = req.body;
  const u = get(
    "SELECT * FROM users WHERE email=?",
    String(email || "").toLowerCase(),
  );
  if (
    !u ||
    typeof password !== "string" ||
    !timingSafeEqual(
      Buffer.from(u.hash, "hex"),
      scryptSync(password, u.salt, 64),
    )
  )
    return res.status(401).json({ error: "E-mail ou senha incorretos." });
  attempts.delete(key);
  login(u.id, res);
});
// Usado pelo próprio programa para descobrir se já há uma janela aberta nesta
// porta antes de subir outra. Responde só em 127.0.0.1, como o resto do servidor.
app.get("/api/health", (req, res) =>
  res.json({ app: "aof-studio", version: APP_VERSION }),
);
function sameOrigin(req) {
  try {
    return new URL(req.headers.origin).host === req.get("host");
  } catch {
    return false;
  }
}
// Desktop window lifecycle is independent of login; an ephemeral, per-process
// token is required, so an ordinary page cannot stop an unrelated local server.
for (const [path, action] of [
  ["heartbeat", "heartbeat"],
  ["close", "closing"],
]) {
  app.post(`/api/desktop/${path}`, (req, res) => {
    if (!desktop) return res.sendStatus(404);
    if (
      !desktop.validToken(req.body?.token) ||
      (req.headers.origin && !sameOrigin(req))
    )
      return res.sendStatus(403);
    if (!desktop[action](req.body?.windowId)) return res.sendStatus(400);
    res.status(204).end();
  });
}
app.use("/api", auth, (req, res, next) => {
  if (
    !["GET", "HEAD"].includes(req.method) &&
    req.headers.origin &&
    !sameOrigin(req)
  )
    return res.status(403).json({ error: "Origem inválida." });
  next();
});
app.get("/api/me", (req, res) =>
  res.json(safeUser(get("SELECT * FROM users WHERE id=?", req.uid))),
);
app.post("/api/logout", (req, res) => {
  stmt("DELETE FROM sessions WHERE token=?", cookie(req));
  res.setHeader(
    "Set-Cookie",
    "session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0",
  );
  res.json({ ok: true });
});
app.get("/api/data", (req, res) => {
  const result = {
    clients: [],
    products: [],
    packages: [],
    documents: [],
    settings: defaultSettings,
    quoteTemplates: QUOTE_TEMPLATES,
  };
  for (const r of db
    .prepare("SELECT * FROM records WHERE user_id=? ORDER BY id DESC")
    .all(req.uid)) {
    const v = { ...JSON.parse(r.body), id: r.id };
    if (r.kind === "settings") result.settings = v;
    else result[r.kind]?.push(v);
  }
  res.json(result);
});
function validate(kind, b) {
  if (!b || typeof b !== "object") return "Dados inválidos.";
  if (kind === "settings") {
    const logoError = validateLogos(b);
    if (logoError) return logoError;
  }
  if (["clients", "packages", "products"].includes(kind) && !b.name?.trim())
    return "Nome obrigatório.";
  if (
    kind === "packages" &&
    (!Number.isFinite(Number(b.price)) || Number(b.price) < 0)
  )
    return "Preço inválido.";
  if (kind === "products") {
    if (!CATEGORY_IDS.includes(b.category))
      return "Selecione em qual quadro do contrato o produto aparece.";
    if (
      b.price != null &&
      b.price !== "" &&
      (!Number.isFinite(Number(b.price)) || Number(b.price) < 0)
    )
      return "Valor de referência inválido.";
  }
  // Itens escolhidos do catálogo, em pacotes e documentos. O nome e a categoria
  // ficam gravados junto: o documento não deve mudar se o produto for editado depois.
  if (["packages", "documents"].includes(kind) && b.items != null) {
    if (!Array.isArray(b.items)) return "Itens inválidos.";
    if (b.items.length > 200) return "Limite de 200 itens.";
    for (const item of b.items) {
      if (!String(item?.name || "").trim())
        return "Todo item precisa de um nome.";
      if (!CATEGORY_IDS.includes(item.category))
        return "Todo item precisa de um quadro válido do contrato.";
      if (
        !Number.isInteger(Number(item.qty)) ||
        Number(item.qty) < 1 ||
        Number(item.qty) > 999
      )
        return "Quantidade de item inválida.";
    }
  }
  if (
    kind === "settings" &&
    b.quoteValidityDays != null &&
    b.quoteValidityDays !== "" &&
    (!Number.isInteger(Number(b.quoteValidityDays)) ||
      Number(b.quoteValidityDays) < 1 ||
      Number(b.quoteValidityDays) > 365)
  )
    return "Informe uma validade padrão entre 1 e 365 dias.";
  if (kind === "documents") {
    if (
      !b.client?.name ||
      !b.event ||
      !b.date ||
      !["quote", "contract"].includes(b.type) ||
      !["draft", "sent", "approved", "signed", "cancelled"].includes(b.status)
    )
      return "Preencha cliente, evento, data e situação.";
    if (!Number.isFinite(Number(b.total)) || Number(b.total) < 0)
      return "Valor inválido.";
    if (b.type === "quote" && b.templateId) {
      const template = getQuoteTemplate(b.templateId);
      if (!template || !template.offers.some((offer) => offer.id === b.offerId))
        return "Selecione um modelo e uma opção de serviço válidos.";
      if (
        b.cashTotal == null ||
        !Number.isFinite(Number(b.cashTotal)) ||
        Number(b.cashTotal) < 0
      )
        return "Informe um valor à vista válido.";
      if (
        b.installmentTotal != null &&
        (!Number.isFinite(Number(b.installmentTotal)) ||
          Number(b.installmentTotal) < 0)
      )
        return "Informe um valor parcelado válido.";
      if (
        !["cash", "installments"].includes(b.paymentChoice) ||
        (b.paymentChoice === "installments" && b.installmentTotal == null)
      )
        return "Selecione uma condição de pagamento disponível.";
      if (
        !Number.isInteger(Number(b.installmentCount)) ||
        Number(b.installmentCount) < 0 ||
        Number(b.installmentCount) > 36
      )
        return "Informe entre 0 e 36 parcelas para o cartão.";
      const selectedPrice = Number(
        b.paymentChoice === "installments" ? b.installmentTotal : b.cashTotal,
      );
      if (Math.abs(Number(b.total) - selectedPrice) > 0.01)
        return "O total deve corresponder à condição de pagamento selecionada.";
    }
    if (
      !Array.isArray(b.payments) ||
      b.payments.some(
        (p) =>
          !p.date || !Number.isFinite(Number(p.amount)) || Number(p.amount) < 0,
      )
    )
      return "Parcelas inválidas.";
    if (
      b.payments.length &&
      Math.abs(
        b.payments.reduce((s, p) => s + Number(p.amount), 0) - Number(b.total),
      ) > 0.01
    )
      return "A soma das parcelas deve ser igual ao total.";
  }
  return null;
}
app.post("/api/records/:kind", (req, res) => {
  const kind = req.params.kind;
  if (
    !["clients", "products", "packages", "documents", "settings"].includes(kind)
  )
    return res.sendStatus(404);
  const b = req.body;
  const error = validate(kind, b);
  if (error) return res.status(400).json({ error });
  if (
    kind === "settings" &&
    b.quoteValidityDays != null &&
    b.quoteValidityDays !== ""
  )
    b.quoteValidityDays = Number(b.quoteValidityDays);
  const existing =
    b.id &&
    get(
      "SELECT * FROM records WHERE id=? AND user_id=? AND kind=?",
      b.id,
      req.uid,
      kind,
    );
  if (b.id && !existing) return res.sendStatus(404);
  if (kind === "settings") {
    const previous = existing ? JSON.parse(existing.body) : {};
    for (const field of LOGO_FIELDS) {
      if (b[field] === undefined) b[field] = previous[field] ?? null;
      else if (b[field] === "") b[field] = null;
    }
  }
  if (kind === "documents" && b.type === "quote") {
    const old = existing ? JSON.parse(existing.body) : null;
    b.quoteTemplate = b.templateId
      ? old?.templateId === b.templateId && old.quoteTemplate
        ? old.quoteTemplate
        : structuredClone(getQuoteTemplate(b.templateId))
      : null;
  }
  if (
    kind === "documents" &&
    existing &&
    JSON.parse(existing.body).type !== b.type
  )
    return res
      .status(400)
      .json({ error: "O tipo do documento não pode ser alterado." });
  if (kind === "documents" && !existing) {
    // Campos controlados pelo servidor não vêm do navegador em documentos novos.
    const copiedFrom =
      typeof b.copiedFrom === "string" && b.copiedFrom.length <= 40
        ? b.copiedFrom
        : null;
    for (const field of [
      "history",
      "sentAt",
      "archived",
      "archivedAt",
      "updatedAt",
      "sourceId",
      "copiedFrom",
    ])
      delete b[field];
    b.history = [historyEvent("created", copiedFrom ? { copiedFrom } : {})];
    b.updatedAt = new Date().toISOString();
    b.number = `${b.type === "contract" ? "CT" : "OR"}-${new Date().getFullYear()}-${randomBytes(3).toString("hex").toUpperCase()}`;
    b.company = {
      ...JSON.parse(
        (
          get(
            "SELECT body FROM records WHERE user_id=? AND kind='settings'",
            req.uid,
          ) || {}
        ).body || JSON.stringify(defaultSettings),
      ),
    };
    b.createdAt = new Date().toISOString();
  }
  if (existing && kind === "documents") {
    const old = JSON.parse(existing.body);
    b.number = old.number;
    b.company = old.company;
    b.createdAt = old.createdAt;
    // Vínculo, envio, arquivamento e histórico só mudam pelas rotas próprias.
    delete b.copiedFrom;
    for (const field of ["sourceId", "sentAt", "archived", "archivedAt"]) {
      if (old[field] === undefined) delete b[field];
      else b[field] = old[field];
    }
    b.history = withEvent(
      old,
      old.status !== b.status
        ? historyEvent("status", { from: old.status, to: b.status })
        : historyEvent("edited"),
    );
    b.updatedAt = new Date().toISOString();
  }
  if (existing)
    stmt(
      "UPDATE records SET body=? WHERE id=? AND user_id=?",
      JSON.stringify(b),
      b.id,
      req.uid,
    );
  else b.id = put(req.uid, kind, b);
  res.json(b);
});
app.post("/api/documents/:id/convert", (req, res) => {
  const r = get(
    "SELECT * FROM records WHERE id=? AND user_id=? AND kind='documents'",
    req.params.id,
    req.uid,
  );
  if (!r) return res.sendStatus(404);
  const old = JSON.parse(r.body);
  if (old.type !== "quote")
    return res.status(400).json({ error: "Selecione um orçamento." });
  const prior = db
    .prepare("SELECT id,body FROM records WHERE user_id=? AND kind='documents'")
    .all(req.uid)
    .find((x) => JSON.parse(x.body).sourceId === r.id);
  if (prior) return res.json({ ...JSON.parse(prior.body), id: prior.id });
  const defaultPaymentNotes =
    "À vista: parcela única na assinatura. Boleto: condições a combinar, com quitação até 10 dias antes do evento.";
  const paymentNotes =
    old.templateId &&
    old.paymentChoice === "installments" &&
    old.paymentNotes?.trim() === defaultPaymentNotes
      ? "Pagamento parcelado no cartão conforme a condição escolhida. Boleto: condições a combinar, com quitação até 10 dias antes do evento."
      : old.paymentNotes;
  const now = new Date().toISOString();
  const b = {
    ...old,
    paymentNotes,
    clauses: old.clauses || old.company?.clauses || defaultSettings.clauses,
    type: "contract",
    status: "draft",
    sourceId: r.id,
    number: `CT-${new Date().getFullYear()}-${randomBytes(3).toString("hex").toUpperCase()}`,
    createdAt: now,
    updatedAt: now,
    history: [historyEvent("created", { fromQuote: old.number })],
  };
  for (const field of ["id", "sentAt", "archived", "archivedAt"])
    delete b[field];
  const id = put(req.uid, "documents", b);
  old.history = withEvent(
    old,
    historyEvent("converted", { contractId: id, number: b.number }),
  );
  stmt(
    "UPDATE records SET body=? WHERE id=? AND user_id=?",
    JSON.stringify(old),
    r.id,
    req.uid,
  );
  res.json({ ...b, id });
});
function findDocument(req) {
  const r = get(
    "SELECT * FROM records WHERE id=? AND user_id=? AND kind='documents'",
    req.params.id,
    req.uid,
  );
  return r ? { ...JSON.parse(r.body), id: r.id } : null;
}
function saveDocument(req, doc) {
  const { id, ...body } = doc;
  stmt(
    "UPDATE records SET body=? WHERE id=? AND user_id=?",
    JSON.stringify(body),
    id,
    req.uid,
  );
  return doc;
}
app.post("/api/documents/:id/archive", (req, res) => {
  const doc = findDocument(req);
  if (!doc) return res.sendStatus(404);
  if (doc.archived) return res.json(doc);
  doc.archived = true;
  doc.archivedAt = new Date().toISOString();
  doc.history = withEvent(doc, historyEvent("archived"));
  res.json(saveDocument(req, doc));
});
app.post("/api/documents/:id/restore", (req, res) => {
  const doc = findDocument(req);
  if (!doc) return res.sendStatus(404);
  if (!doc.archived) return res.json(doc);
  delete doc.archived;
  delete doc.archivedAt;
  doc.history = withEvent(doc, historyEvent("restored"));
  res.json(saveDocument(req, doc));
});
// Exclusão definitiva só para documentos arquivados: evita apagar algo ativo por engano.
app.delete("/api/documents/:id", (req, res) => {
  const doc = findDocument(req);
  if (!doc) return res.sendStatus(404);
  if (!doc.archived)
    return res
      .status(409)
      .json({ error: "Arquive o documento antes de excluir definitivamente." });
  stmt(
    "DELETE FROM records WHERE id=? AND user_id=? AND kind='documents'",
    doc.id,
    req.uid,
  );
  res.json({ ok: true });
});
// Registra o envio (por exemplo, pelo WhatsApp). Rascunho passa a "Enviado".
app.post("/api/documents/:id/sent", (req, res) => {
  const doc = findDocument(req);
  if (!doc) return res.sendStatus(404);
  if (doc.archived || doc.status === "cancelled")
    return res
      .status(409)
      .json({
        error: "Documentos arquivados ou cancelados não podem ser enviados.",
      });
  const channel = ["whatsapp", "share"].includes(req.body?.channel)
    ? req.body.channel
    : "other";
  const extra = doc.status === "draft" ? { from: "draft", to: "sent" } : {};
  if (doc.status === "draft") doc.status = "sent";
  doc.sentAt = new Date().toISOString();
  doc.history = withEvent(doc, historyEvent("sent", { channel, ...extra }));
  res.json(saveDocument(req, doc));
});
// Clientes e pacotes: os documentos guardam os dados da emissão, então excluir
// o cadastro não altera documentos já emitidos.
app.delete("/api/records/:kind/:id", (req, res) => {
  if (!["clients", "products", "packages"].includes(req.params.kind))
    return res.sendStatus(404);
  const result = stmt(
    "DELETE FROM records WHERE id=? AND user_id=? AND kind=?",
    req.params.id,
    req.uid,
    req.params.kind,
  );
  if (!result.changes) return res.sendStatus(404);
  res.json({ ok: true });
});
// Fontes lidas uma vez. Dentro do executável vêm embutidas, não do disco.
const FONTS = {
  body: readAsset("assets/fonts/DejaVuSans.ttf"),
  heading: readAsset("assets/fonts/DejaVuSans-Bold.ttf"),
};
app.get("/api/documents/:id/pdf", (req, res) => {
  const r = get(
    "SELECT body FROM records WHERE id=? AND user_id=? AND kind='documents'",
    req.params.id,
    req.uid,
  );
  if (!r) return res.sendStatus(404);
  const b = JSON.parse(r.body),
    c = b.company || defaultSettings;
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader(
    "Content-Disposition",
    `${req.query.inline === "1" ? "inline" : "attachment"}; filename="${b.number}.pdf"`,
  );
  const doc = new PDFDocument({
    size: "A4",
    margins: { top: 48, left: 48, right: 48, bottom: 70 },
    bufferPages: true,
    // A fonte vai já no construtor: sem isso o PDFKit carrega as métricas da
    // Helvetica de um arquivo em disco, que não existe dentro do executável.
    font: FONTS.body,
    info: {
      Title: `${b.type === "contract" ? "Contrato" : "Orçamento"} ${b.number}`,
      Author: c.company,
    },
  });
  doc.registerFont("Body", FONTS.body);
  doc.registerFont("Heading", FONTS.heading);
  doc.pipe(res);
  if (b.type === "quote") {
    renderQuotePdf(
      doc,
      b,
      c,
      b.quoteTemplate || getQuoteTemplate(b.templateId) || null,
    );
    doc.end();
    return;
  }
  renderContractPdf(doc, b, c);
  doc.end();
});
app.use(serveAssets("public"));
app.use((err, req, res, next) => {
  console.error(err.message);
  if (!res.headersSent)
    res.status(500).json({ error: "Não foi possível concluir a operação." });
});
// Sistema local: escuta somente em 127.0.0.1, então nada na rede alcança o
// servidor nem o banco. Para publicar em servidor, use HOST e COOKIE_SECURE.
const HOST = process.env.HOST || "127.0.0.1";
const FIRST_PORT = 3000;
const LAST_PORT = 3019;

function openBrowser(port) {
  if (process.platform !== "win32") return;
  spawn("cmd", ["/c", "start", "", `http://localhost:${port}`], {
    detached: true,
    stdio: "ignore",
    windowsHide: true,
  })
    .on("error", () => {})
    .unref();
}
function listen(port) {
  return new Promise((resolve, reject) => {
    const server = app.listen(port, HOST);
    server.once("listening", () => {
      runningServer = server;
      resolve(server);
    });
    server.once("error", reject);
  });
}
// A porta está ocupada por outra janela deste mesmo sistema?
async function ourselves(port) {
  try {
    const r = await fetch(`http://${HOST}:${port}/api/health`, {
      signal: AbortSignal.timeout(2000),
    });
    return (await r.json())?.app === "aof-studio";
  } catch {
    return false;
  }
}
async function announce(port) {
  console.log(`${APP_NAME} ${APP_VERSION} · http://localhost:${port}`);
  console.log(`Dados em ${DATA_DIR}`);
  if (desktop) {
    await desktop.open(`http://localhost:${port}`);
    return;
  }
  // Instalado, abre o navegador sozinho; pelo código-fonte, só se pedirem.
  const wanted = packaged
    ? process.env.AOF_OPEN_BROWSER !== "0"
    : process.env.AOF_OPEN_BROWSER === "1";
  if (wanted) openBrowser(port);
}
async function start() {
  // Porta informada é respeitada como está: testes e execução em servidor
  // dependem de um endereço previsível, e falhar é melhor que mudar de porta.
  if (process.env.PORT) {
    await listen(Number(process.env.PORT));
    return announce(Number(process.env.PORT));
  }
  for (let port = FIRST_PORT; port <= LAST_PORT; port++) {
    try {
      await listen(port);
      return announce(port);
    } catch (error) {
      if (error.code !== "EADDRINUSE") throw error;
      // Já aberto: traz a janela existente para a frente em vez de duplicar.
      if (await ourselves(port)) {
        console.log(`${APP_NAME} já está aberto em http://localhost:${port}`);
        if (desktop) {
          await desktop.stop();
          showDesktopNotice(
            "O AOF Studio já está aberto. Use a janela do aplicativo.",
          );
        } else openBrowser(port);
        return process.exit(0);
      }
    }
  }
  throw Error(`Nenhuma porta livre entre ${FIRST_PORT} e ${LAST_PORT}.`);
}
start().catch(async (error) => {
  if (desktop) {
    await desktop.stop();
    reportDesktopError(error);
  } else
    console.error(`Não foi possível iniciar o ${APP_NAME}: ${error.message}`);
  runningServer?.close();
  try {
    db.close();
  } catch {}
  process.exit(1);
});
