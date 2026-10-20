import express from "express";
import { DatabaseSync } from "node:sqlite";
import { scryptSync, randomBytes, timingSafeEqual } from "node:crypto";
import { mkdirSync } from "node:fs";
import { spawn } from "node:child_process";
import PDFDocument from "pdfkit";
import { QUOTE_TEMPLATES, getQuoteTemplate } from "./public/quote-templates.js";
import { renderQuotePdf } from "./quote-pdf.js";
const app = express();
app.disable("x-powered-by");
app.use(express.json({ limit: "1mb" }));
mkdirSync(process.env.DATA_DIR || "data", { recursive: true });
const db = new DatabaseSync(`${process.env.DATA_DIR || "data"}/app.sqlite`);
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
  clauses: initialClauses,
};
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
  put(uid, "packages", {
    name: "Pacote 2 · Som & Luz",
    price: 2700,
    description: "DJ, sonorização e iluminação para sua festa",
    equipment:
      "2 caixas de som\n2 caixas de grave\n2 microfones sem fio\n2 notebooks DJ\n1 controladora DJ\n1 mixer de 2 canais\n4 moving heads\n1 máquina de fumaça\n2 torres de treliça\nTransporte e montagem",
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
function sameOrigin(req) {
  try {
    return new URL(req.headers.origin).host === req.get("host");
  } catch {
    return false;
  }
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
  if (["clients", "packages"].includes(kind) && !b.name?.trim())
    return "Nome obrigatório.";
  if (
    kind === "packages" &&
    (!Number.isFinite(Number(b.price)) || Number(b.price) < 0)
  )
    return "Preço inválido.";
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
  if (!["clients", "packages", "documents", "settings"].includes(kind))
    return res.sendStatus(404);
  const b = req.body;
  const error = validate(kind, b);
  if (error) return res.status(400).json({ error });
  if (kind === "settings" && b.quoteValidityDays != null && b.quoteValidityDays !== "")
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
  if (kind === "documents" && b.type === "quote") {
    const old = existing ? JSON.parse(existing.body) : null;
    b.quoteTemplate = b.templateId
      ? old?.templateId === b.templateId && old.quoteTemplate
        ? old.quoteTemplate
        : structuredClone(getQuoteTemplate(b.templateId))
      : null;
  }
  if (kind === "documents" && !existing) {
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
  const b = {
    ...old,
    paymentNotes,
    clauses: old.clauses || old.company?.clauses || defaultSettings.clauses,
    type: "contract",
    status: "draft",
    sourceId: r.id,
    number: `CT-${new Date().getFullYear()}-${randomBytes(3).toString("hex").toUpperCase()}`,
    createdAt: new Date().toISOString(),
  };
  delete b.id;
  const id = put(req.uid, "documents", b);
  res.json({ ...b, id });
});
const money = (n) =>
  Number(n || 0).toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
  });
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
    info: {
      Title: `${b.type === "contract" ? "Contrato" : "Orçamento"} ${b.number}`,
      Author: c.company,
    },
  });
  doc.registerFont("Body", "assets/fonts/DejaVuSans.ttf");
  doc.registerFont("Heading", "assets/fonts/DejaVuSans-Bold.ttf");
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
  const text = (s, size = 10) =>
    doc
      .font("Body")
      .fontSize(size)
      .fillColor("#334155")
      .text(String(s || "—"), { lineGap: 4 });
  const title = (s) => {
    if (doc.y > 680) doc.addPage();
    doc.moveDown();
    doc.font("Heading").fontSize(12).fillColor("#087f72").text(s);
    doc.moveDown(0.4);
  };
  doc.font("Heading").fontSize(25).fillColor("#0e2928").text(c.company);
  text(c.representative);
  text(`CNPJ ${c.cnpj} | ${c.email}`);
  text(`${c.address || ""}${c.phone ? " | " + c.phone : ""}`);
  doc.moveDown();
  doc
    .font("Heading")
    .fontSize(22)
    .fillColor("#0e2928")
    .text(
      b.type === "contract"
        ? "Contrato de prestação de serviços"
        : "Proposta comercial",
    );
  // Situações internas (enviado, aprovado, assinado) não aparecem no documento do cliente;
  // ficam só os avisos que afetam a validade do documento: rascunho e cancelado.
  const documentWarning = {
    draft: "RASCUNHO — REVISAR ANTES DE ASSINAR",
    cancelled: "CANCELADO",
  }[b.status];
  text(
    `${b.number} • Emissão: ${new Date(b.createdAt).toLocaleDateString("pt-BR")}${documentWarning ? ` • ${documentWarning}` : ""}`,
  );
  title("01 / Cliente e evento");
  text(`${b.client.name} | CPF/CNPJ: ${b.client.document || "Não informado"}`);
  text(`${b.client.email || ""} | ${b.client.phone || ""}`);
  text(b.client.address);
  text(
    `${b.event} • ${b.date.split("-").reverse().join("/")} • ${b.guests || "—"} convidados`,
  );
  text(`Local: ${b.venue || "A definir"}`);
  text(
    `Montagem: ${b.setup || "A definir"} | Cerimônia: ${b.ceremony || "A definir"} | Início: ${b.start || "A definir"} | Término: ${b.end || "A definir"}`,
  );
  title("02 / Serviços e equipamentos");
  text(b.packageName);
  text(b.equipment);
  title("03 / Investimento e pagamento");
  doc.font("Heading").fontSize(22).fillColor("#087f72").text(money(b.total));
  if (b.templateId && b.paymentChoice) {
    text(
      `Condição escolhida: ${b.paymentChoice === "installments" ? "parcelado" : "à vista"}.`,
    );
    if (b.paymentChoice === "installments" && b.cardTerms) text(b.cardTerms);
  }
  text(`Hora adicional: ${money(b.extraHour)} | PIX: ${c.pix || "A combinar"}`);
  for (const [i, p] of b.payments.entries())
    text(
      `${i + 1}ª parcela • ${p.date.split("-").reverse().join("/")} • ${money(p.amount)}`,
    );
  text(b.paymentNotes || "Condições a combinar entre as partes.");
  if (b.type === "quote")
    text(
      `Proposta válida até: ${(b.validUntil || "").split("-").reverse().join("/") || "A combinar"}. Reserva de data mediante formalização contratual.`,
    );
  if (b.type === "contract") {
    title("04 / Cláusulas contratuais");
    text(b.clauses);
    title("05 / Autorização de imagem");
    text(
      b.imageConsent
        ? "O contratante autoriza o uso de imagem do evento nos canais de divulgação da contratada."
        : "Não há autorização de uso de imagem neste instrumento.",
    );
  }
  if (b.notes) {
    title("Observações");
    text(b.notes);
  }
  if (doc.y > 650) doc.addPage();
  doc.moveDown(3);
  text(
    "__________________________________      __________________________________",
  );
  text(
    `${c.representative}                                      ${b.client.name}`,
  );
  text(
    "Contratada                                                        Contratante",
  );
  text(
    "Assinaturas a serem coletadas pelas partes. Este documento não contém assinatura digital.",
  );
  const range = doc.bufferedPageRange();
  for (let i = 0; i < range.count; i++) {
    doc.switchToPage(i);
    doc
      .fontSize(8)
      .fillColor("#64748b")
      .text(
        `${c.company} • ${b.number}                                                  ${i + 1} / ${range.count}`,
        48,
        790,
        { lineBreak: false },
      );
  }
  doc.end();
});
app.use(express.static("public"));
app.use((err, req, res, next) => {
  console.error(err.message);
  if (!res.headersSent)
    res.status(500).json({ error: "Não foi possível concluir a operação." });
});
const port = Number(process.env.PORT || 3000);
app.listen(port, "0.0.0.0", () => {
  console.log("AOF Gestão iniciada na porta " + port);
  // O iniciador do Windows pede para abrir o navegador só quando o servidor já responde.
  if (process.env.AOF_OPEN_BROWSER === "1" && process.platform === "win32")
    spawn("cmd", ["/c", "start", "", `http://localhost:${port}`], {
      detached: true,
      stdio: "ignore",
      windowsHide: true,
    })
      .on("error", () => {})
      .unref();
});
