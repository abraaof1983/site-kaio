import { tryAsset } from "./app-env.js";
import { dateBeforeEvent, getQuoteTemplate } from "./public/quote-templates.js";

const colors = {
  background: "#101719",
  panel: "#172123",
  white: "#F8F7F2",
  muted: "#BBC4C3",
  gold: "#DDC58F",
  line: "#354244",
};
const money = (value) =>
  Number(value).toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
  });
const amount = (value) =>
  value !== "" &&
  value != null &&
  Number.isFinite(Number(value)) &&
  Number(value) >= 0;
const date = (value) => {
  const match = String(value || "").match(/^(\d{4})-(\d{2})-(\d{2})/);
  return match ? `${match[3]}/${match[2]}/${match[1]}` : "A combinar";
};
const normalized = (value) =>
  String(value || "")
    .replace(/\s+/g, " ")
    .trim();

/** Draw a quote on a piped PDFKit document. The caller owns doc.end(). */
export function renderQuotePdf(doc, b, company, template = null) {
  const c = company || {};
  // Only an explicitly supplied snapshot enables a model. In particular, old
  // quotes must not acquire today's catalogue prices when downloaded again.
  const model = template;
  const catalogue = model ? getQuoteTemplate(model.id || b.templateId) : null;
  const offers = Array.isArray(model?.offers) ? model.offers : [];
  const selected = offers.find((offer) => offer.id === b.offerId) || offers[0];
  const autoNotes = [selected?.description, model?.reservationNotes].filter(
    Boolean,
  );
  const notes = model
    ? normalized(b.notes) === normalized(autoNotes.join(" "))
      ? ""
      : String(b.notes || "")
          .split(/\r?\n/)
          .filter(
            (part) =>
              !autoNotes.some(
                (automatic) => normalized(automatic) === normalized(part),
              ),
          )
          .join("\n")
          .trim()
    : b.notes;
  const brand =
    model?.brand || catalogue?.brand || c.company || "Proposta comercial";
  const margin = 48;
  const width = doc.page.width - margin * 2;
  const bottom = () => doc.page.height - 67;
  let y = 0;

  function font(size = 9, bold = false, color = colors.white) {
    doc
      .font(bold ? "Heading" : "Body")
      .fontSize(size)
      .fillColor(color);
  }
  function line(
    text,
    x,
    top,
    { size = 9, bold = false, color = colors.white } = {},
  ) {
    font(size, bold, color);
    doc.text(String(text ?? ""), x, top, { lineBreak: false });
  }
  function fit(text, maxWidth, size = 8, bold = false) {
    font(size, bold);
    const source = String(text || "")
      .replace(/\s+/g, " ")
      .trim();
    if (doc.widthOfString(source) <= maxWidth) return source;
    let clipped = source;
    while (clipped && doc.widthOfString(`${clipped}…`) > maxWidth)
      clipped = clipped.slice(0, -1);
    return `${clipped}…`;
  }
  function wrap(text, maxWidth, size = 9, bold = false) {
    font(size, bold);
    const lines = [];
    for (const paragraph of String(text ?? "")
      .replace(/\r/g, "")
      .split("\n")) {
      if (!paragraph.trim()) {
        lines.push("");
        continue;
      }
      let current = "";
      for (const originalWord of paragraph.trim().split(/\s+/)) {
        let word = originalWord;
        if (current && doc.widthOfString(`${current} ${word}`) <= maxWidth) {
          current += ` ${word}`;
          continue;
        }
        if (current) {
          lines.push(current);
          current = "";
        }
        // Long URLs and unbroken text still fit the printable column.
        while (doc.widthOfString(word) > maxWidth) {
          let part = "";
          for (const char of word) {
            if (part && doc.widthOfString(part + char) > maxWidth) break;
            part += char;
          }
          if (!part) part = word[0];
          lines.push(part);
          word = word.slice(part.length);
        }
        current = word;
      }
      if (current) lines.push(current);
    }
    return lines;
  }
  function rule(top = y, color = colors.line) {
    doc
      .save()
      .strokeColor(color)
      .lineWidth(0.6)
      .moveTo(margin, top)
      .lineTo(margin + width, top)
      .stroke()
      .restore();
  }
  function paint(continuation = false) {
    doc
      .save()
      .rect(0, 0, doc.page.width, doc.page.height)
      .fill(colors.background)
      .restore();
    const logo = model ? tryAsset("public/quote-assets/logo.jpg") : null;
    const showLogo = Boolean(logo);
    const top = 39;
    if (showLogo) {
      doc
        .save()
        .circle(margin + 23, top + 23, 23)
        .clip();
      doc.image(logo, margin, top, {
        fit: [46, 46],
        align: "center",
        valign: "center",
      });
      doc.restore();
    }
    const bx = showLogo ? margin + 61 : margin;
    const bw = width - (bx - margin);
    const brandLines = wrap(brand, bw, continuation ? 16 : 20, true);
    const brandHeight = brandLines.length * (continuation ? 20 : 24);
    for (const [index, brandLine] of brandLines.entries()) {
      line(brandLine, bx, top + index * (continuation ? 20 : 24), {
        size: continuation ? 16 : 20,
        bold: true,
      });
    }
    const tagline =
      model?.tagline ||
      catalogue?.tagline ||
      [c.representative, c.cnpj && `CNPJ ${c.cnpj}`]
        .filter(Boolean)
        .join(" • ");
    const taglineLines = wrap(tagline, bw, 7.8);
    let headerBottom = top + brandHeight + 3;
    for (const item of taglineLines) {
      line(item, bx, headerBottom, { size: 7.8, color: colors.gold });
      headerBottom += 11;
    }
    headerBottom = Math.max(top + (showLogo ? 46 : 0), headerBottom);
    // A situação (rascunho, enviado…) é interna: não vai para o documento do cliente.
    const meta = [b.number, `Emissão: ${date(b.createdAt)}`]
      .filter(Boolean)
      .join("   •   ");
    const metaLines = wrap(meta, width, 7.1);
    headerBottom += 12;
    for (const item of metaLines) {
      line(item, margin, headerBottom, { size: 7.1, color: colors.muted });
      headerBottom += 10;
    }
    rule(headerBottom + 8);
    y = headerBottom + 22;
  }
  function newPage() {
    doc.addPage({
      size: "A4",
      margins: { top: 48, left: 48, right: 48, bottom: 70 },
    });
    paint(true);
  }
  function ensure(height) {
    if (y + height > bottom()) newPage();
  }
  function text(
    textValue,
    {
      size = 9,
      bold = false,
      color = colors.white,
      gap = 5,
      x = margin,
      maxWidth = width,
      lineHeight = size * 1.35,
    } = {},
  ) {
    if (textValue == null || textValue === "") return;
    const lines = wrap(textValue, maxWidth, size, bold);
    for (const textLine of lines) {
      ensure(lineHeight);
      line(textLine, x, y, { size, bold, color });
      y += lineHeight;
    }
    y += gap;
  }
  function section(title, { before = 13, after = 8 } = {}) {
    ensure(before + 33);
    y += before;
    text(title, { size: 9.4, bold: true, color: colors.gold, gap: after });
  }
  function equipment(value) {
    const entries = String(value || "")
      .split(/\r?\n/)
      .map((entry) => entry.trim())
      .filter(Boolean);
    if (!entries.length) return;
    const columnWidth = (width - 23) / 2;
    const prepare = (items) =>
      items.flatMap((entry) => {
        const match = entry.match(/^(\d{1,3})\s*[x×]?\s+(.+)$/);
        const quantity = match ? match[1].padStart(2, "0") : "";
        const content = match ? match[2] : entry;
        return wrap(content, columnWidth - (quantity ? 28 : 0), 9).map(
          (part, index) => ({
            text: part,
            quantity: index === 0 ? quantity : "",
            inset: quantity ? 28 : 0,
          }),
        );
      });
    const mid = Math.ceil(entries.length / 2);
    const left = prepare(entries.slice(0, mid));
    const right = prepare(entries.slice(mid));
    for (let row = 0; row < Math.max(left.length, right.length); row++) {
      ensure(15);
      [left[row], right[row]].forEach((entry, index) => {
        if (!entry) return;
        const x = margin + index * (columnWidth + 23);
        if (entry.quantity)
          line(entry.quantity, x, y - 0.7, {
            size: 11,
            bold: true,
            color: colors.gold,
          });
        line(entry.text, x + entry.inset, y, { size: 9 });
      });
      y += 15;
    }
    y += 3;
  }
  function priceCards() {
    let cash = amount(b.cashTotal) ? Number(b.cashTotal) : null;
    let installment = amount(b.installmentTotal)
      ? Number(b.installmentTotal)
      : null;
    if (b.paymentChoice === "cash" && cash == null && amount(b.total))
      cash = Number(b.total);
    if (
      b.paymentChoice === "installments" &&
      installment == null &&
      amount(b.total)
    )
      installment = Number(b.total);
    const cards = [];
    if (cash != null)
      cards.push({
        title: "À VISTA",
        value: cash,
        mode: "cash",
        detail:
          selected?.id === "complete"
            ? "Parcela única na assinatura."
            : "Pagamento a combinar.",
      });
    if (installment != null) {
      const count = Number(b.installmentCount);
      cards.push({
        title: "TOTAL PARCELADO",
        value: installment,
        mode: "installments",
        detail:
          Number.isInteger(count) && count > 0
            ? `Até ${count}x de ${money(installment / count)} no cartão.`
            : "Parcelamento a combinar.",
      });
    }
    if (!cards.length)
      cards.push({
        title: "INVESTIMENTO",
        value: amount(b.total) ? Number(b.total) : 0,
        mode: b.paymentChoice,
        detail: "Condições conforme esta proposta.",
      });
    const gutter = 12;
    const cardWidth = (width - gutter * (cards.length - 1)) / cards.length;
    const cardHeight = 91;
    ensure(cardHeight + 5);
    const top = y;
    cards.forEach((card, index) => {
      const x = margin + index * (cardWidth + gutter);
      const selectedPrice = card.mode === b.paymentChoice;
      doc
        .save()
        .roundedRect(x, top, cardWidth, cardHeight, 5)
        .fillAndStroke(colors.panel, selectedPrice ? colors.gold : colors.line)
        .restore();
      line(card.title, x + 13, top + 10, {
        size: 8,
        bold: true,
        color: colors.gold,
      });
      if (selectedPrice)
        line("OPÇÃO SELECIONADA", x + 13, top + 23, {
          size: 6.3,
          bold: true,
          color: colors.muted,
        });
      const value = money(card.value);
      let size = cards.length === 1 ? 26 : 23;
      font(size, true);
      while (doc.widthOfString(value) > cardWidth - 26 && size > 11) {
        size--;
        font(size, true);
      }
      line(value, x + 13, top + 34, { size, bold: true });
      const details = wrap(card.detail, cardWidth - 26, 7.6);
      details
        .slice(0, 2)
        .forEach((item, i) =>
          line(item, x + 13, top + 66 + i * 10, {
            size: 7.6,
            color: colors.muted,
          }),
        );
    });
    y += cardHeight + 9;
    const chosenPrice = b.paymentChoice === "installments" ? installment : cash;
    if (
      amount(b.total) &&
      chosenPrice != null &&
      Math.abs(Number(b.total) - chosenPrice) > 0.01
    ) {
      text(`Valor negociado para esta proposta: ${money(b.total)}.`, {
        size: 9,
        bold: true,
        color: colors.gold,
      });
    }
  }
  // Na proposta bastam os contatos; CPF/CNPJ e endereço ficam só no contrato
  // (princípio da necessidade da LGPD).
  function contactDetails() {
    const client = b.client || {};
    const contact = [client.email, client.phone].filter(Boolean).join("  •  ");
    if (contact) text(contact, { size: 7.5, color: colors.muted, gap: 3 });
  }
  function howToBook() {
    const channel = c.phone
      ? `pelo WhatsApp ${c.phone}`
      : c.email
        ? `pelo e-mail ${c.email}`
        : "";
    return [
      channel &&
        `Como contratar: confirme ${channel} e enviaremos o contrato para assinatura.`,
      c.pix && `Pix para pagamento: ${c.pix}.`,
    ]
      .filter(Boolean)
      .join(" ");
  }
  function conditions() {
    ensure(43);
    y += 8;
    rule();
    y += 11;
    if (selected?.description)
      text(selected.description, { size: 8.1, bold: true, gap: 5 });
    if (model) {
      const deadline = dateBeforeEvent(b.date);
      text(
        deadline
          ? `Boleto: condições a combinar, com quitação até ${date(deadline)} (10 dias antes do evento).`
          : "Boleto: condições e prazo de quitação a combinar.",
        { size: 8.1, gap: 5 },
      );
      const count = Number(b.installmentCount);
      const standardCardTerms =
        amount(b.installmentTotal) && count > 0
          ? `Até ${count}x de ${money(Number(b.installmentTotal) / count)} no cartão.`
          : "Condições de parcelamento a combinar.";
      if (
        b.cardTerms &&
        normalized(b.cardTerms) !== normalized(standardCardTerms)
      )
        text(`Cartão: ${b.cardTerms}`, { size: 8.1, gap: 5 });
    }
    const standardPaymentNotes =
      selected?.id === "complete"
        ? "À vista: parcela única na assinatura. Boleto: condições a combinar, com quitação até 10 dias antes do evento."
        : "Condições de pagamento a combinar.";
    if (
      b.paymentNotes &&
      (!model ||
        normalized(b.paymentNotes) !== normalized(standardPaymentNotes))
    )
      text(b.paymentNotes, { size: 8.1, color: colors.muted, gap: 5 });
    if (amount(b.extraHour) && Number(b.extraHour) > 0)
      text(`Hora adicional: ${money(b.extraHour)}.`, { size: 8.1, gap: 5 });
    if (b.validUntil)
      text(`Proposta válida até ${date(b.validUntil)}.`, {
        size: 8.1,
        bold: true,
        color: colors.gold,
        gap: 5,
      });
    const nextStep = howToBook();
    if (nextStep) text(nextStep, { size: 8.4, bold: true, gap: 5 });
    text(
      model?.reservationNotes ||
        "Reserva de data mediante disponibilidade e formalização da contratação.",
      { size: 8, color: colors.muted, gap: 4 },
    );
  }
  function paymentSchedule() {
    if (!Array.isArray(b.payments) || !b.payments.length) return;
    section("PLANO DE PAGAMENTO ACORDADO");
    for (const [index, payment] of b.payments.entries()) {
      text(
        `${index + 1}ª parcela  •  ${date(payment.date)}  •  ${money(payment.amount || 0)}`,
        { size: 8.5, gap: 3 },
      );
    }
  }
  function alternatives() {
    const otherOffers = offers.filter((offer) => offer.id !== selected?.id);
    if (!otherOffers.length) return;
    newPage();
    text("Outras opções para seu evento", { size: 23, bold: true, gap: 8 });
    text(
      "As opções abaixo são independentes. Seus valores não são somados ao pacote selecionado nesta proposta.",
      { size: 9, color: colors.muted, gap: 18 },
    );
    for (const offer of otherOffers) {
      ensure(97);
      rule();
      y += 12;
      text(offer.name, { size: 12, bold: true, color: colors.gold, gap: 7 });
      const priceParts = [];
      if (amount(offer.cashPrice))
        priceParts.push(
          `${money(offer.cashPrice)}${amount(offer.installmentPrice) ? " à vista" : ""}`,
        );
      if (amount(offer.installmentPrice))
        priceParts.push(`${money(offer.installmentPrice)} parcelado`);
      text(
        priceParts.length ? priceParts.join("     •     ") : "Valor a combinar",
        { size: 14, bold: true, gap: 6 },
      );
      if (
        amount(offer.installmentPrice) &&
        Number(offer.installmentCount) > 0
      ) {
        text(
          `Até ${offer.installmentCount}x de ${money(Number(offer.installmentPrice) / Number(offer.installmentCount))} no cartão.`,
          { size: 8.5, color: colors.muted, gap: 5 },
        );
      }
      if (offer.description)
        text(offer.description, { size: 8.5, color: colors.muted, gap: 6 });
      if (offer.equipment)
        text(offer.equipment, { size: 8, color: colors.muted, gap: 8 });
      y += 9;
    }
    ensure(70);
    rule();
    y += 12;
    text("SUA PROPOSTA SELECIONADA", {
      size: 9,
      bold: true,
      color: colors.gold,
      gap: 5,
    });
    text(
      `${b.packageName || selected?.name || "Pacote personalizado"} • ${money(amount(b.total) ? b.total : 0)}`,
      { size: 10, bold: true, gap: 5 },
    );
    text(
      "A composição final e a reserva da data dependem da formalização da contratação.",
      { size: 8.5, color: colors.muted, gap: 5 },
    );
  }

  paint();
  text(b.quoteHeadline || model?.headline || "Proposta comercial", {
    size: 25,
    bold: true,
    gap: 11,
  });

  const venue = b.venue || model?.venue || "Local a definir";
  const dateWidth = 125;
  const venueLines = wrap(venue, width - dateWidth, 11, true);
  ensure(Math.max(1, venueLines.length) * 15 + 7);
  line(date(b.date), margin, y, { size: 11.5, bold: true, color: colors.gold });
  venueLines.forEach((item, index) =>
    line(item, margin + dateWidth, y + index * 15, { size: 11, bold: true }),
  );
  y += Math.max(1, venueLines.length) * 15 + 8;
  text(`Preparado para ${b.client?.name || "Cliente a definir"}`, {
    size: 9,
    bold: true,
    gap: 3,
  });
  if (b.event)
    text(`Evento: ${b.event}`, { size: 8, color: colors.muted, gap: 3 });
  contactDetails();
  const schedule = [
    b.guests && `${b.guests} convidados`,
    b.setup && `Montagem ${b.setup}`,
    b.ceremony && `Cerimônia ${b.ceremony}`,
    b.start && `Início ${b.start}`,
    b.end && `Término ${b.end}`,
  ]
    .filter(Boolean)
    .join("  •  ");
  if (schedule) text(schedule, { size: 7.5, color: colors.muted, gap: 3 });
  const introduction = b.introduction ?? model?.introduction;
  if (introduction)
    text(introduction, { size: 8.5, color: colors.muted, gap: 9 });

  const hero = model ? tryAsset("public/quote-assets/estrutura.png") : null;
  if (hero) {
    const imageHeight = 165;
    const caption = wrap(
      model.imageCaption ||
        catalogue?.imageCaption ||
        "Imagem ilustrativa da estrutura.",
      width,
      6.7,
    );
    ensure(imageHeight + caption.length * 9 + 12);
    doc.save().roundedRect(margin, y, width, imageHeight, 4).clip();
    doc.image(hero, margin, y, {
      cover: [width, imageHeight],
      align: "center",
      valign: "center",
    });
    doc.restore();
    y += imageHeight + 5;
    for (const item of caption) {
      line(item, margin, y, { size: 6.7, color: colors.muted });
      y += 9;
    }
    y += 6;
  }

  section(b.packageName || selected?.name || "SERVIÇOS E EQUIPAMENTOS", {
    before: 6,
    after: 6,
  });
  equipment(b.equipment);
  y += 7;
  if (model) priceCards();
  else {
    ensure(70);
    rule();
    y += 12;
    text("INVESTIMENTO", { size: 8.5, bold: true, color: colors.gold, gap: 4 });
    text(money(amount(b.total) ? b.total : 0), {
      size: 27,
      bold: true,
      gap: 8,
    });
  }
  paymentSchedule();
  conditions();
  if (notes && offers.length < 2) {
    section("OBSERVAÇÕES", { before: 10, after: 5 });
    text(notes, { size: 8.5, color: colors.muted, gap: 5 });
  }
  if (offers.length > 1) {
    // Never create a page solely for this navigation hint.
    if (y + 15 < bottom())
      text("Veja também as opções independentes nas próximas páginas.", {
        size: 7.5,
        color: colors.gold,
        gap: 4,
      });
  }
  alternatives();
  if (notes && offers.length > 1) {
    section("OBSERVAÇÕES", { before: 10, after: 5 });
    text(notes, { size: 8.5, color: colors.muted, gap: 5 });
  }

  // Keep footer drawing outside normal text flow so it cannot create blank pages.
  const range = doc.bufferedPageRange();
  for (let i = range.start; i < range.start + range.count; i++) {
    doc.switchToPage(i);
    const footerY = doc.page.height - 39;
    rule(footerY - 12);
    const contact = [c.company || brand, c.email, c.phone]
      .filter(Boolean)
      .join("  •  ");
    line(fit(contact, width - 62, 6.8), margin, footerY, {
      size: 6.8,
      color: colors.muted,
    });
    const pageLabel = `${i - range.start + 1} / ${range.count}`;
    font(7, true);
    line(pageLabel, margin + width - doc.widthOfString(pageLabel), footerY, {
      size: 7,
      bold: true,
      color: colors.gold,
    });
  }
}
