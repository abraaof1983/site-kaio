import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import PDFDocument from "pdfkit";
import { readAsset } from "../app-env.js";
import { renderQuotePdf } from "../quote-pdf.js";
import { EVENT_TYPES } from "../public/event-types.js";
import { QUOTE_TEMPLATES } from "../public/quote-templates.js";

const hash = (buffer) => createHash("sha256").update(buffer).digest("hex");
const bodyFont = readAsset("assets/fonts/DejaVuSans.ttf");
const headingFont = readAsset("assets/fonts/DejaVuSans-Bold.ttf");
const fixture = {
  number: "ORC-2027-001",
  type: "quote",
  status: "draft",
  event: "Celebração de exemplo",
  client: { name: "Cliente de exemplo" },
  date: "2027-08-21",
  venue: "Salão de festas",
  packageName: "Som e iluminação",
  equipment: "01 DJ\n02 caixas de som\n04 refletores",
  total: 2900,
  cashTotal: 2900,
  installmentTotal: 3199,
  installmentCount: 10,
  paymentChoice: "cash",
  payments: [],
  validUntil: "2027-07-21",
};

async function render(t, values = {}, model = null) {
  const doc = new PDFDocument({
    size: "A4",
    margins: { top: 48, left: 48, right: 48, bottom: 70 },
    bufferPages: true,
    font: bodyFont,
  });
  doc.registerFont("Body", bodyFont);
  doc.registerFont("Heading", headingFont);
  // Observe the actual drawing calls without replacing PDFKit's rendering.
  const image = t.mock.method(doc, "image");
  const text = t.mock.method(doc, "text");
  const chunks = [];
  const finished = new Promise((resolve, reject) => {
    doc.on("data", (chunk) => chunks.push(chunk));
    doc.once("end", resolve);
    doc.once("error", reject);
  });
  renderQuotePdf(doc, { ...fixture, ...values }, { company: "Empresa exemplo" }, model);
  doc.end();
  await finished;
  const bytes = Buffer.concat(chunks);
  assert.equal(bytes.subarray(0, 5).toString(), "%PDF-");
  return {
    bytes,
    images: image.mock.calls.map(({ arguments: [buffer] }) => hash(buffer)),
    text: text.mock.calls.map(({ arguments: [value] }) => String(value)).join(" "),
  };
}

test("cada tipo de evento incorpora sua imagem nos orçamentos personalizados e com modelo", async (t) => {
  const distinctImages = new Set();
  for (const event of EVENT_TYPES) {
    const expectedImage = hash(readAsset(event.imagePath));
    distinctImages.add(expectedImage);
    for (const model of [null, QUOTE_TEMPLATES[0]]) {
      const pdf = await render(t, { eventType: event.id }, model);
      assert.ok(pdf.images.includes(expectedImage), `${event.label}: imagem deve entrar no PDF`);
      assert.match(pdf.bytes.toString("latin1"), /\/Subtype \/Image\b/);
      assert.ok(pdf.text.includes(`Tipo de evento: ${event.label}`));
      assert.ok(pdf.text.includes(event.headline));
      assert.ok(pdf.text.includes(event.introduction));
      assert.ok(pdf.text.includes("R$"));
    }
  }
  assert.equal(distinctImages.size, 4, "As quatro categorias devem ter imagens diferentes");
});

test("orçamentos antigos mantêm a imagem e os textos anteriores sem atribuir um evento", async (t) => {
  const generic = await render(t);
  assert.equal(generic.images.length, 0);
  assert.ok(generic.text.includes("Proposta comercial"));
  assert.ok(!generic.text.includes("Tipo de evento:"));

  const model = QUOTE_TEMPLATES[0];
  const legacy = await render(t, {}, model);
  assert.ok(legacy.images.includes(hash(readAsset("public/quote-assets/estrutura.png"))));
  assert.ok(legacy.text.includes(model.headline));
  assert.ok(legacy.text.includes(model.introduction));
  assert.ok(!legacy.text.includes("Tipo de evento:"));
});

test("o tipo do evento não substitui título e apresentação personalizados", async (t) => {
  const event = EVENT_TYPES.find((value) => value.id === "formatura");
  const pdf = await render(t, {
    eventType: event.id,
    quoteHeadline: "Uma noite memorável",
    introduction: "Proposta preparada exclusivamente para esta turma.",
  }, QUOTE_TEMPLATES[0]);
  assert.ok(pdf.text.includes("Uma noite memorável"));
  assert.ok(pdf.text.includes("Proposta preparada exclusivamente para esta turma."));
  assert.ok(!pdf.text.includes(event.headline));
  assert.ok(pdf.images.includes(hash(readAsset(event.imagePath))));
});
