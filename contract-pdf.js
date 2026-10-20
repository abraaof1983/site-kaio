import { tryAsset } from "./app-env.js";

// Contrato no formato do modelo da AOF: moldura e cabeçalho com logos em todas as
// páginas, ficha do evento em tabela, cláusulas numeradas, pacote e programação
// financeira, equipamentos por categoria, local e data, assinaturas e rodapé.
const C = {
  text: "#111111",
  muted: "#3a3a3a",
  line: "#000000",
  red: "#C00000",
  navy: "#1F3864",
  blue: "#2F5597",
};
const LH = 1.22; // entrelinha compacta, como no modelo
const WEEKDAYS = ["Domingo", "Segunda-feira", "Terça-feira", "Quarta-feira", "Quinta-feira", "Sexta-feira", "Sábado"];
const CEP = /\b\d{5}-?\d{3}\b/;
// Só quebra linha em espaço comum: o espaço fixo de "R$ 1.000,00" mantém o valor inteiro.
const SPACES = /[ \t\r\n]+/;
const money = (v) => Number(v || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const ymd = (v) => String(v || "").match(/^(\d{4})-(\d{2})-(\d{2})/);
const brDate = (v) => (ymd(v) ? `${ymd(v)[3]}/${ymd(v)[2]}/${ymd(v)[1]}` : "");
const weekday = (v) => (ymd(v) ? WEEKDAYS[new Date(`${ymd(v)[0]}T12:00:00Z`).getUTCDay()] : "");
const hhmm = (v) => String(v || "").match(/^(\d{1,2}):(\d{2})/);
// "18:30" → "18h30"; "04:00" → "4h", como no modelo.
const hour = (v) => {
  const m = hhmm(v);
  if (!m) return String(v || "");
  return m[2] === "00" ? `${Number(m[1])}h` : `${Number(m[1])}h${m[2]}`;
};
const minutes = (v) => (hhmm(v) ? Number(hhmm(v)[1]) * 60 + Number(hhmm(v)[2]) : null);
const plain = (v) =>
  String(v ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
const issueDate = (iso) =>
  new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", day: "numeric", month: "long", year: "numeric" }).format(
    iso ? new Date(iso) : new Date(),
  );
// "Abraão Ferreira · DJ Kaio Jansen" → "Abraão Ferreira (DJ Kaio Jansen)", como no modelo.
const person = (v) => String(v || "").trim().replace(/\s*·\s*(.+)$/, " ($1)");
// Primeiro logo disponível, já como Buffer: funciona em disco e dentro do executável.
const firstAsset = (...names) => names.reduce((found, name) => found || tryAsset(`public/quote-assets/${name}`), null);

// Cidade do endereço da empresa: o trecho antes da UF ("Blumenau, SC" ou "Blumenau · SC").
export function cityOf(address) {
  const text = String(address || "");
  const parts = text.split(/[,·|–-]/).map((s) => s.trim()).filter(Boolean);
  const uf = parts.findIndex((p, i) => i > 0 && /^[A-Z]{2}$/.test(p));
  if (uf > 0 && !/\d/.test(parts[uf - 1])) return parts[uf - 1];
  return text.match(/([A-Za-zÀ-ú][A-Za-zÀ-ú ]+?)\s*\/\s*[A-Z]{2}\b/)?.[1].trim() || "";
}

// Categorias do quadro de equipamentos do modelo. A ordem dos testes importa:
// "caixa de som da cerimônia" vai para cerimônia, e não para som da festa.
const GROUPS = [
  { id: "ceremony", title: "EQUIPAMENTOS DE SOM CERIMÔNIA", test: /cerimonia|mesa de som/ },
  { id: "media", title: "KIT MÍDIA FOTOS E VÍDEOS", test: /foto|video|telao|projetor|camera/ },
  { id: "scenic", title: "CÊNICAS – ILUMINAÇÃO DECORATIVA", test: /cenic|decorativ|uplight|luminaria/ },
  { id: "light", title: "ILUMINAÇÃO E EFEITOS PARA DANÇA", test: /moving|beam|fumaca|laser|strobo|\bled\b|refletor|\bpar\b|trelica|ilumina|\bluz|efeito|faisca/ },
  { id: "dj", title: "EQUIPAMENTOS DJ FESTA", test: /notebook|macbook|controladora|mixer|cdj|toca.?disco|\bfone|\bdj\b/ },
  { id: "sound", title: "EQUIPAMENTOS DE SOM “FESTA”", test: /caixa|grave|\bsub|microfone|\bmic\b|amplificador|\bsom\b/ },
];
const BANDS = [
  ["sound", "dj", "light"],
  ["ceremony", "media", "scenic"],
];
// Linhas como "04 Moving heads Beam 200". Uma linha terminada em ":" abre uma
// categoria própria; itens que não se encaixam vão para "Outros itens".
export function equipmentGroups(text) {
  const groups = Object.fromEntries(GROUPS.map((g) => [g.id, []]));
  const custom = [],
    others = [];
  let current = null;
  for (const raw of String(text || "").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    if (line.endsWith(":")) {
      current = { title: line.slice(0, -1).trim().toUpperCase(), items: [] };
      custom.push(current);
      continue;
    }
    const m = line.match(/^(\d{1,3})\s*[x×]?\s+(.+)$/);
    const item = { qty: m ? m[1].padStart(2, "0") : "", name: m ? m[2] : line };
    if (current) {
      current.items.push(item);
      continue;
    }
    const group = GROUPS.find((g) => g.test.test(plain(item.name)));
    (group ? groups[group.id] : others).push(item);
  }
  if (others.length) custom.push({ title: "OUTROS ITENS", items: others });
  return { groups, custom };
}
// Cláusulas como "1. TÍTULO" seguido do texto, ou "5.1 TÍTULO: texto". Uma linha numerada
// com título em maiúsculas abre cláusula nova, mesmo sem linha em branco antes; uma linha
// em branco encerra o parágrafo, e o texto seguinte sem número vira parágrafo próprio.
export function parseClauses(text) {
  const clauses = [];
  let current = null;
  const upper = (s) => s === s.toUpperCase() && /[A-ZÀ-Ú]/.test(s);
  for (const raw of String(text || "").replace(/\r/g, "").split("\n")) {
    const line = raw.trim();
    if (!line) {
      current = null;
      continue;
    }
    let m = line.match(/^(\d+(?:\.\d+)*)[.)]?\s+([^:]{2,60}):\s*(.*)$/);
    if (m && upper(m[2])) {
      clauses.push((current = { num: m[1], title: m[2].trim(), body: m[3] }));
      continue;
    }
    m = line.match(/^(\d+(?:\.\d+)*)[.)]?\s+(.{2,60})$/);
    if (m && upper(m[2])) {
      clauses.push((current = { num: m[1], title: m[2].trim(), body: "" }));
      continue;
    }
    if (current) current.body = [current.body, line].filter(Boolean).join(" ");
    else clauses.push((current = { num: "", title: "", body: line }));
  }
  return clauses;
}

/** Desenha o contrato num PDFKit já conectado à resposta. Quem chama faz doc.end(). */
export function renderContractPdf(doc, b, company = {}) {
  const c = company || {},
    client = b.client || {};
  const M = 34,
    W = doc.page.width - M * 2,
    TOP = 112,
    BOTTOM = doc.page.height - 80;
  const lh = (size) => size * LH;
  const aof = firstAsset("logo-aof.png", "logo-aof.jpg");
  const kaio = firstAsset("logo-contrato.png", "logo-contrato.jpg");
  const kaioDark = kaio ? null : firstAsset("logo.jpg"); // fundo preto: recortado em círculo
  const docLabel = String(client.document || "").replace(/\D/g, "").length > 11 ? "CNPJ:" : "CPF:";
  let y = TOP;

  function font(size, bold = false, color = C.text) {
    doc.font(bold ? "Heading" : "Body").fontSize(size).fillColor(color);
  }
  function put(text, x, top, { size = 8, bold = false, color = C.text } = {}) {
    font(size, bold, color);
    doc.text(String(text ?? ""), x, top, { lineBreak: false });
  }
  function textWidth(text, size, bold = false) {
    font(size, bold);
    return doc.widthOfString(String(text ?? ""));
  }
  function fit(text, max, size, bold = false) {
    let s = String(text ?? "").replace(/\s+/g, " ").trim();
    if (textWidth(s, size, bold) <= max) return s;
    while (s && textWidth(`${s}…`, size, bold) > max) s = s.slice(0, -1);
    return `${s}…`;
  }
  // Rótulo em negrito seguido de texto normal, na mesma linha.
  function labeled(x, top, label, text, size, max) {
    const lw = textWidth(`${label} `, size, true);
    put(label, x, top, { size, bold: true });
    put(fit(text, max - lw, size), x + lw, top, { size });
  }
  // Quebra trechos com negrito/sublinhado em linhas que cabem em `max`.
  // `after` num trecho acrescenta espaço depois dele (o número da cláusula, por exemplo).
  function layout(segments, max, size, indent = 0) {
    font(size);
    const space = doc.widthOfString(" "),
      lines = [];
    let line = [],
      used = 0;
    const room = () => max - (lines.length ? 0 : indent);
    const close = () => {
      lines.push({ tokens: line, used });
      line = [];
      used = 0;
    };
    for (const seg of segments)
      for (let word of String(seg.text ?? "").split(SPACES).filter(Boolean)) {
        const token = () => ({ word, bold: Boolean(seg.bold), underline: Boolean(seg.underline), color: seg.color, after: seg.after || 0, w: textWidth(word, size, seg.bold) });
        let t = token();
        while (t.w > room() && word.length > 1) {
          // Palavra maior que a linha (um e-mail ou link, por exemplo): quebra por caractere.
          let part = word;
          while (part.length > 1 && textWidth(part, size, seg.bold) > room()) part = part.slice(0, -1);
          if (line.length) close();
          const rest = word.slice(part.length);
          word = part;
          line.push(token());
          close();
          word = rest;
          t = token();
        }
        const prev = line.at(-1);
        const add = prev ? space + prev.after + t.w : t.w;
        if (prev && used + add > room()) close();
        used += line.length ? add : t.w;
        line.push(t);
      }
    if (line.length) close();
    return { lines, space };
  }
  function drawLine(ln, x, top, size, space, { justify = false, last = true, max = 0 } = {}) {
    const extra = justify && !last && ln.tokens.length > 1 ? Math.max(0, (max - ln.used) / (ln.tokens.length - 1)) : 0;
    for (const t of ln.tokens) {
      font(size, t.bold, t.color);
      doc.text(t.word, x, top, { lineBreak: false });
      if (t.underline)
        doc.save().lineWidth(0.5).strokeColor(t.color || C.text).moveTo(x, top + size * 1.02).lineTo(x + t.w, top + size * 1.02).stroke().restore();
      x += t.w + t.after + space + extra;
    }
  }
  // Moldura e cabeçalho, repetidos em todas as páginas como no modelo.
  function frame() {
    doc.save().lineWidth(0.8).strokeColor(C.line).rect(22, 22, doc.page.width - 44, doc.page.height - 44).stroke().restore();
    let x = M;
    const logo = (src, round) => {
      if (round) doc.save().circle(x + 23, 51, 23).clip();
      doc.image(src, x, 28, { fit: [46, 46], align: "center", valign: "center" });
      if (round) doc.restore();
      x += 51;
    };
    if (aof) logo(aof, false);
    if (kaio || kaioDark) logo(kaio || kaioDark, !kaio);
    // Título com a base alinhada ao pé dos logos, como no modelo.
    const title = "CONTRATO DE PRESTAÇÃO DE SERVIÇOS",
      size = Math.min(15.5, (15.5 * (M + W - x - 4)) / textWidth(title, 15.5, true));
    put(title, x + 3, 74 - size * 0.93, { size, bold: true });
    const warning = { draft: "RASCUNHO · REVISAR ANTES DE ASSINAR", cancelled: "CANCELADO" }[b.status];
    if (warning) put(warning, M + W - textWidth(warning, 7, true), 27, { size: 7, bold: true, color: C.red });
    const when = [brDate(b.date), weekday(b.date)].filter(Boolean).join(" – ") || "Data a definir";
    put(when, M, 79, { size: 12.5, bold: true });
    put(fit(`CONTRATO: ${b.number || ""}`, W * 0.4, 10.5, true), M + W * 0.6, 81, { size: 10.5, bold: true });
    put(fit(b.event || "", W * 0.58, 9.8, true), M, 96, { size: 9.8, bold: true });
    if (b.referral) put(fit(`INDICAÇÃO: ${b.referral}`, W * 0.4, 9.8, true), M + W * 0.6, 96, { size: 9.8, bold: true });
    y = TOP;
  }
  function ensure(height) {
    if (y + height <= BOTTOM) return;
    doc.addPage();
    frame();
  }
  // Parágrafo justificado. `indent` recua só a primeira linha; `left` recua todas
  // (com `bullet`, o marcador fica no recuo, como numa lista).
  function paragraph(segments, { size = 8, indent = 0, left = 0, bullet = "", justify = true, gap = 2.4 } = {}) {
    const width = W - left,
      { lines, space } = layout(segments, width, size, indent);
    ensure(Math.min(lines.length, 2) * lh(size)); // não deixa a primeira linha sozinha no pé da página
    lines.forEach((ln, i) => {
      ensure(lh(size));
      if (bullet && i === 0) put(bullet, M + left - 10, y, { size, bold: true });
      const first = i === 0 ? indent : 0;
      drawLine(ln, M + left + first, y, size, space, { justify, last: i === lines.length - 1, max: width - first });
      y += lh(size);
    });
    y += gap;
  }
  // Linha de tabela com bordas. Cada célula: { w (fração da largura), label (negrito), text, bold }.
  function row(cells, { size = 7.8, padX = 2.6, padY = 1.7 } = {}) {
    const widths = cells.map((cell) => cell.w * W);
    const laid = cells.map((cell, i) =>
      layout([{ text: cell.label, bold: true }, { text: cell.text, bold: cell.bold }], widths[i] - padX * 2, size),
    );
    const height = Math.max(1, ...laid.map((l) => l.lines.length)) * lh(size) + padY * 2;
    ensure(height);
    let x = M;
    cells.forEach((cell, i) => {
      doc.save().lineWidth(0.6).strokeColor(C.line).rect(x, y, widths[i], height).stroke().restore();
      laid[i].lines.forEach((ln, k) => drawLine(ln, x + padX, y + padY + k * lh(size), size, laid[i].space));
      x += widths[i];
    });
    y += height;
  }
  // Célula de uma linha só, usada no quadro de equipamentos.
  function cell(x, top, w, h, text, bold, size) {
    doc.save().lineWidth(0.6).strokeColor(C.line).rect(x, top, w, h).stroke().restore();
    if (text) put(fit(text, w - 5, size, bold), x + 2.6, top + (h - lh(size)) / 2 + 0.3, { size, bold });
  }
  // ---------- Ficha do cliente e do evento (linhas fixas, em branco quando vazias) ----------
  function sheet() {
    const L = 0.105,
      R = 0.23,
      MID = 1 - L - R;
    const source = String(client.address || ""),
      cep = source.match(CEP)?.[0] || "";
    const address = cep
      ? source
          .replace(/\bCEP\b:?\s*/i, "")
          .replace(CEP, "")
          .replace(/\s*,\s*,/g, ",")
          .replace(/^[\s,–-]+|[\s,–-]+$/g, "")
      : source;
    // Término depois da meia-noite: "4h da manhã", como no modelo.
    const end = minutes(b.end),
      start = minutes(b.start);
    const final = end != null && start != null && end < start && end >= 60 && end < 720 ? `${hour(b.end)} da manhã` : hour(b.end);
    row([{ w: L, label: "Nome" }, { w: MID, text: client.name }, { w: R, label: docLabel, text: client.document, bold: true }]);
    row([{ w: L, label: "Endereço" }, { w: MID, text: address }, { w: R, label: "CEP:", text: cep, bold: true }]);
    // O e-mail fica na célula mais larga para não quebrar no meio.
    row([{ w: L, label: "Contato" }, { w: 0.25, text: client.phone }, { w: 0.27, text: b.contact2 }, { w: 0.375, text: client.email }]);
    row([{ w: L, label: "Local" }, { w: MID, text: b.venue }, { w: R, label: "CONVIDADOS:", text: b.guests, bold: true }]);
    row([
      { w: L, label: "Horários" },
      { w: 0.235, label: "Montagem:", text: hour(b.setup), bold: true },
      { w: 0.215, label: "Cerimônia:", text: hour(b.ceremony), bold: true },
      { w: 0.215, label: "Festa:", text: hour(b.start), bold: true },
      { w: R, label: "Final:", text: final, bold: true },
    ]);
    row([{ w: L, label: "Recepção" }, { w: 1 - L, text: b.reception }]);
    row([{ w: L, label: "Cerimônia" }, { w: 0.495, text: b.ceremonyPlace }, { w: 0.4, label: "Celebrante:", text: b.officiant, bold: true }]);
    row([
      { w: L, label: "Gerente" },
      { w: 0.315, text: b.venueManager },
      { w: 0.29, label: "Bartender:", text: b.bartender, bold: true },
      { w: 0.29, label: "Decoração:", text: b.decoration, bold: true },
    ]);
    row([
      { w: L, label: "Cerimonial" },
      { w: 0.195, text: b.planner },
      { w: 0.235, label: "Foto:", text: b.photo, bold: true },
      { w: 0.235, label: "Vídeo:", text: b.video, bold: true },
      { w: R, label: "Doces:", text: b.sweets, bold: true },
    ]);
  }
  // ---------- Pacote, condição e programação financeira ----------
  function commercial() {
    const sentence = (s) => {
      const t = String(s || "").trim();
      return !t || /[.!?…:;)]$/.test(t) ? t : `${t}.`;
    };
    const terms = String(b.cardTerms || "").trim().replace(/\.$/, "");
    const condition =
      b.templateId && b.paymentChoice
        ? b.paymentChoice === "installments"
          ? `parcelado${terms ? ` (${terms.charAt(0).toLowerCase()}${terms.slice(1)})` : ""}`
          : "à vista"
        : "";
    const parcels = (b.payments || []).map((p, i) => `${i + 1}ª em ${brDate(p.date)} – ${money(p.amount)}`);
    const plan = [
      ...String(b.paymentNotes || "").split(/\n+/).map(sentence),
      parcels.length && sentence(`Parcelas: ${parcels.join("; ")}`),
      c.pix && sentence(`Chave PIX: ${c.pix}`),
    ].filter(Boolean);
    const L = 0.225;
    row([{ w: L, label: "Pacote contratado" }, { w: 1 - L, text: [b.packageName, money(b.total), condition].filter(Boolean).join(" – ") }]);
    row([{ w: L, label: "Programação financeira" }, { w: 1 - L, text: plan.join(" ") }]);
    if (Number(b.extraHour) > 0) row([{ w: L, label: "Hora adicional" }, { w: 1 - L, text: `${money(b.extraHour)} por hora.` }]);
  }
  // ---------- Quadro de equipamentos por categoria ----------
  function equipment() {
    if (!String(b.equipment || "").trim()) return;
    const { groups, custom } = equipmentGroups(b.equipment);
    const size = 7.4,
      h = lh(size) + 3.4,
      colW = W / 3,
      qtyW = 22;
    const item = (x, it) => {
      cell(x, y, qtyW, h, it?.qty || "", false, size);
      cell(x + qtyW, y, colW - qtyW, h, it?.name || "", false, size);
    };
    for (const ids of BANDS) {
      const cols = ids.map((id) => ({ title: GROUPS.find((g) => g.id === id).title, items: groups[id] }));
      const rows = Math.max(1, ...cols.map((col) => col.items.length));
      ensure(h * Math.min(rows + 1, 4));
      cols.forEach((col, i) => cell(M + i * colW, y, colW, h, col.title, true, size));
      y += h;
      for (let r = 0; r < rows; r++) {
        ensure(h);
        cols.forEach((col, i) => item(M + i * colW, col.items[r]));
        y += h;
      }
    }
    for (const group of custom) {
      ensure(h * 2);
      cell(M, y, W, h, group.title, true, size);
      y += h;
      for (let r = 0; r < Math.ceil(group.items.length / 3); r++) {
        ensure(h);
        for (let i = 0; i < 3; i++) item(M + i * colW, group.items[r * 3 + i]);
        y += h;
      }
    }
    y += 10;
  }
  // ---------- Local, data e assinaturas ----------
  function signatures() {
    const city = cityOf(c.address),
      half = W / 2 - 16;
    ensure(128);
    y += 4;
    put(`${city ? `${city}, ` : ""}${issueDate(b.createdAt)}.`, M, y, { size: 8.8, bold: true });
    y += 76; // espaço para assinar à mão ou para o selo da assinatura digital (gov.br)
    [
      [M, "CONTRATADA:", person(c.representative) || c.company, [c.company, c.cnpj && `CNPJ ${c.cnpj}`].filter(Boolean).join(" · ")],
      [M + W / 2 + 16, "CONTRATANTE:", client.name, client.document ? `${docLabel} ${client.document}` : ""],
    ].forEach(([x, label, name, sub]) => {
      doc.save().lineWidth(0.6).strokeColor(C.line).moveTo(x, y).lineTo(x + half, y).stroke().restore();
      labeled(x, y + 4, label, name, 8, half);
      if (sub) put(fit(sub, half, 7.4), x, y + 15, { size: 7.4, color: C.muted });
    });
    y += 30;
  }
  // ---------- Rodapé com contato e numeração ("Página 1 de 2") ----------
  function footers() {
    const range = doc.bufferedPageRange();
    for (let i = range.start; i < range.start + range.count; i++) {
      doc.switchToPage(i);
      const top = doc.page.height - 72,
        name = c.company || "",
        contact = fit([c.phone, c.address].filter(Boolean).join(" / "), W - 120, 8),
        page = `Página ${i - range.start + 1} de ${range.count}`,
        center = (text, size, bold) => (doc.page.width - textWidth(text, size, bold)) / 2;
      put(name, center(name, 9.2, true), top, { size: 9.2, bold: true, color: C.navy });
      put(contact, center(contact, 8), top + 13, { size: 8, color: C.blue });
      put(page, M + W - textWidth(page, 8), top + 29, { size: 8, color: C.navy });
    }
  }

  frame();
  sheet();
  y += 5;
  commercial();
  y += 7;
  const party = [
    c.company || "a CONTRATADA",
    c.cnpj && `CNPJ ${c.cnpj}`,
    c.representative && `neste ato representada por ${person(c.representative)}`,
  ].filter(Boolean).join(", ");
  paragraph(
    [{ text: `Pelo presente instrumento particular de contrato, de um lado a CONTRATADA, ${party}, e, de outro, o(a) CONTRATANTE acima qualificado(a), têm entre si justo e contratado o que mutuamente outorgam e aceitam:` }],
    { indent: 40, gap: 3 },
  );
  for (const clause of parseClauses(b.clauses))
    paragraph(
      clause.num
        ? [{ text: clause.num, bold: true, underline: true, after: 7 }, { text: `${clause.title}:`, bold: true }, { text: clause.body }]
        : [{ text: clause.body }],
      { indent: clause.num ? 12 : 0 },
    );
  y += 4;
  row([
    { w: 0.225, label: "Uso de imagem" },
    {
      w: 0.775,
      text: b.imageConsent
        ? "Autorizado: o(a) CONTRATANTE autoriza o uso de imagem do evento nos canais de divulgação da CONTRATADA."
        : "Não autorizado: não há autorização de uso de imagem neste instrumento.",
    },
  ]);
  y += 10;
  equipment();
  for (const note of String(b.notes || "").split(/\n+/).map((s) => s.trim()).filter(Boolean))
    paragraph([{ text: note, bold: true }], { size: 7.6, left: 22, bullet: "•", justify: false, gap: 2 });
  signatures();
  footers();
}
