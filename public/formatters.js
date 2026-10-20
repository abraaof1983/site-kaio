// Funções puras de formatação e cálculo usadas pela interface.
// Não dependem do DOM, para poderem ser verificadas também no Node.

const BRL_INPUT = new Intl.NumberFormat("pt-BR", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const CPF = "000.000.000-00";
const CNPJ = "00.000.000/0000-00";

/**
 * Converte valores digitados em reais para número.
 * Aceita "2.900,50", "2900,5", "2900.50", "R$ 2.900" e números.
 * Vazio → null; texto inválido → NaN.
 */
export function parseMoney(value) {
  if (typeof value === "number") return Number.isFinite(value) ? value : NaN;
  const text = String(value ?? "")
    .replace(/^\s*R\$\s*/i, "")
    .replace(/\s+/g, "");
  if (!text) return null;
  if (text.includes(",")) {
    const parts = text.split(",");
    if (parts.length !== 2) return NaN;
    const [integer, decimals] = parts;
    if (!/^(\d{1,3}(\.\d{3})+|\d+)$/.test(integer) || !/^\d{0,2}$/.test(decimals))
      return NaN;
    return Number(`${integer.replace(/\./g, "")}.${decimals || "0"}`);
  }
  // "2.900" segue o padrão brasileiro de milhar; "2900.5" usa ponto decimal.
  if (/^\d{1,3}(\.\d{3})+$/.test(text)) return Number(text.replace(/\./g, ""));
  if (/^\d+(\.\d{1,2})?$/.test(text)) return Number(text);
  return NaN;
}

/** Formata para edição no campo: 2900 → "2.900,00". Vazio → "". */
export function formatMoneyInput(value) {
  if (value === "" || value == null) return "";
  const number = parseMoney(value);
  if (number == null) return "";
  if (Number.isNaN(number)) return String(value);
  return BRL_INPUT.format(number);
}

/** Divide um total em parcelas iguais, em centavos; a diferença fica na última. */
export function splitAmount(total, count) {
  const cents = Math.round(Number(total) * 100);
  const parts = Math.max(1, Math.floor(Number(count) || 1));
  const base = Math.floor(cents / parts);
  return Array.from(
    { length: parts },
    (_, index) => (index === parts - 1 ? cents - base * (parts - 1) : base) / 100,
  );
}

function applyPattern(digits, pattern) {
  let output = "",
    index = 0;
  for (const char of pattern) {
    if (index >= digits.length) break;
    output += char === "0" ? digits[index++] : char;
  }
  return output;
}

/**
 * Máscara progressiva de CPF (até 11 dígitos) ou CNPJ (12 a 14 dígitos).
 * Textos com letras (CNPJ alfanumérico, passaporte) ficam como foram digitados.
 */
export function maskDocument(value) {
  const raw = String(value ?? "");
  if (/[^\d.\-/\s]/.test(raw)) return raw;
  const digits = raw.replace(/\D/g, "");
  if (digits.length > 14) return raw;
  return applyPattern(digits, digits.length <= 11 ? CPF : CNPJ);
}

/** Máscara de telefone brasileiro com DDD: (47) 3333-3333 ou (47) 99999-9999. */
export function maskPhone(value) {
  const raw = String(value ?? "");
  if (/[^\d()\-\s]/.test(raw)) return raw; // +55, ramal ou texto livre
  const digits = raw.replace(/\D/g, "");
  if (digits.length > 11) return raw;
  return applyPattern(
    digits,
    digits.length <= 10 ? "(00) 0000-0000" : "(00) 00000-0000",
  );
}

/** Soma dias a uma data AAAA-MM-DD, sem efeito de fuso horário. */
export function addDays(isoDate, days) {
  if (!ISO_DATE.test(isoDate || "")) return "";
  const date = new Date(`${isoDate}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + Number(days || 0));
  return date.toISOString().slice(0, 10);
}

/** Dias entre duas datas AAAA-MM-DD; negativo quando `to` já passou. */
export function daysBetween(from, to) {
  if (!ISO_DATE.test(from || "") || !ISO_DATE.test(to || "")) return null;
  return Math.round(
    (Date.parse(`${to}T12:00:00Z`) - Date.parse(`${from}T12:00:00Z`)) / 86400000,
  );
}
