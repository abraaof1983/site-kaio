// Regras puras dos documentos: situação exibida, abas, busca, ordenação,
// validade e mensagem de envio. Sem DOM, para poderem ser verificadas no Node.
import { daysBetween } from "./formatters.js";

export const STATUS_LABELS = {
  draft: "Rascunho",
  sent: "Enviado",
  approved: "Aprovado",
  signed: "Assinado",
  cancelled: "Cancelado",
  expired: "Vencido",
  converted: "Convertido",
  archived: "Arquivado",
};
export const TAB_LABELS = {
  all: "Todos",
  draft: "Rascunhos",
  sent: "Enviados",
  approved: "Aprovados",
  signed: "Assinados",
  expired: "Vencidos",
  converted: "Convertidos",
  cancelled: "Cancelados",
  archived: "Arquivados",
};
export const TABS = {
  quote: ["all", "draft", "sent", "approved", "expired", "converted", "cancelled"],
  contract: ["all", "draft", "sent", "approved", "signed", "cancelled"],
};
export const SORT_LABELS = {
  recent: "Mais recentes",
  eventAsc: "Data do evento (crescente)",
  eventDesc: "Data do evento (decrescente)",
  value: "Maior valor",
};

/** Texto sem acentos e em minúsculas, para buscas como "orcamento" ou "joao". */
export const normalizeText = (value) =>
  String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();

/**
 * Situação exibida. Orçamento com contrato gerado é "converted"; rascunho ou
 * enviado com validade passada é "expired". O arquivamento é tratado à parte.
 */
export function displayStatus(doc, { contract = null, today } = {}) {
  if (doc.type === "quote") {
    if (contract) return "converted";
    if (["draft", "sent"].includes(doc.status) && doc.validUntil && today && doc.validUntil < today)
      return "expired";
  }
  return doc.status;
}

/** Aviso de validade de orçamentos ainda em negociação. */
export function validityInfo(doc, status, today) {
  if (doc.type !== "quote" || !doc.validUntil || !["draft", "sent", "expired"].includes(status)) return null;
  const days = daysBetween(today, doc.validUntil);
  if (days == null) return null;
  const short = doc.validUntil.split("-").reverse().slice(0, 2).join("/");
  if (days < 0) return { tone: "late", text: `Venceu em ${short}` };
  if (days === 0) return { tone: "warn", text: "Vence hoje" };
  if (days <= 3) return { tone: "warn", text: `Vence em ${days} ${days === 1 ? "dia" : "dias"}` };
  return { tone: "", text: `Válido até ${short}` };
}

export function matchesSearch(doc, term) {
  const query = normalizeText(term);
  if (!query) return true;
  return normalizeText(
    [doc.client?.name, doc.event, doc.number, doc.venue].filter(Boolean).join(" "),
  ).includes(query);
}

/** Mais recentes = criados por último (ids maiores primeiro). */
export function sortDocs(list, sort = "recent") {
  const byRecent = (a, b) => (b.id ?? 0) - (a.id ?? 0);
  const copy = [...list];
  if (sort === "eventAsc")
    return copy.sort((a, b) => (a.date || "9999-12-31").localeCompare(b.date || "9999-12-31") || byRecent(a, b));
  if (sort === "eventDesc")
    return copy.sort((a, b) => (b.date || "").localeCompare(a.date || "") || byRecent(a, b));
  if (sort === "value") return copy.sort((a, b) => Number(b.total || 0) - Number(a.total || 0) || byRecent(a, b));
  return copy.sort(byRecent);
}

/** Contagem por aba. `entries` = [{ doc, status }]; arquivados só contam na própria aba. */
export function tabCounts(entries, tabs) {
  const counts = Object.fromEntries([...tabs, "archived"].map((tab) => [tab, 0]));
  for (const { doc, status } of entries) {
    if (doc.archived) {
      counts.archived++;
      continue;
    }
    counts.all++;
    if (status in counts && status !== "all") counts[status]++;
  }
  return counts;
}

export function inTab({ doc, status }, tab) {
  if (tab === "archived") return Boolean(doc.archived);
  if (doc.archived) return false;
  return tab === "all" || status === tab;
}

const brl = (value) =>
  Number(value || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const brDate = (value) => (value ? value.split("-").reverse().join("/") : "");

function greeting(client = {}) {
  const name = String(client.name || "").trim();
  const digits = String(client.document || "").replace(/\D/g, "");
  const company = digits.length === 14 || /\b(ltda|eireli|me|epp|s\/?a|s\.a\.)\b/i.test(name);
  const first = name.split(/\s+/)[0];
  return company || !first ? "Olá! Tudo bem?" : `Olá, ${first}! Tudo bem?`;
}

/** Mensagem pronta para o WhatsApp; continua editável antes de enviar. */
export function whatsappMessage(doc, { company = {} } = {}) {
  const isQuote = doc.type === "quote";
  const where = doc.venue ? `, no ${doc.venue}` : "";
  const when = doc.date ? `, em ${brDate(doc.date)}` : "";
  const event = doc.event ? ` para ${doc.event}` : "";
  const lines = [greeting(doc.client)];
  if (isQuote) {
    lines.push("", `Segue o orçamento ${doc.number}${event}${when}${where}.`);
    const choice =
      doc.templateId && doc.paymentChoice ? (doc.paymentChoice === "installments" ? " (parcelado)" : " (à vista)") : "";
    lines.push("", `Valor: ${brl(doc.total)}${choice}.`);
    if (doc.validUntil) lines.push(`Proposta válida até ${brDate(doc.validUntil)}.`);
    lines.push("", "O PDF com todos os detalhes vai anexado. Qualquer dúvida, é só chamar.");
  } else {
    lines.push(
      "",
      `Segue o contrato ${doc.number}${event}${when}.`,
      "",
      "Revise os dados e as cláusulas. Se estiver tudo certo, assine e me envie de volta. O PDF vai anexado.",
    );
  }
  const signature = company.representative || company.company;
  if (signature) lines.push("", signature);
  return lines.join("\n");
}

export function whatsappLink(number, text) {
  return `https://wa.me/${number || ""}?text=${encodeURIComponent(text || "")}`;
}
