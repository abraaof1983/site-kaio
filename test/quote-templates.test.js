import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { QUOTE_TEMPLATES, dateBeforeEvent } from "../public/quote-templates.js";

test("modelos embarcados, valores, atualização, PDF e conversão preservam a conta", async () => {
  const dir = mkdtempSync(join(tmpdir(), "aof-quotes-"));
  let child;
  const start = async () => {
    child = spawn(process.execPath, ["server.js"], {
      env: { ...process.env, PORT: "3013", DATA_DIR: dir },
      stdio: ["ignore", "pipe", "pipe"],
    });
    await new Promise((resolve, reject) => {
      child.stdout.once("data", resolve);
      child.once("error", reject);
      child.once("exit", (code) => reject(Error("Servidor encerrou: " + code)));
    });
  };
  const stop = async () => {
    const closed = new Promise((resolve) => child.once("exit", resolve));
    child.kill();
    await closed;
  };
  let cookie = "";
  const call = async (path, body, expected = 200) => {
    const r = await fetch("http://127.0.0.1:3013/api" + path, {
      method: body ? "POST" : "GET",
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: body ? JSON.stringify(body) : undefined,
    });
    assert.equal(r.status, expected, path);
    if (r.headers.get("set-cookie"))
      cookie = r.headers.get("set-cookie").split(";")[0];
    if (r.headers.get("content-type")?.includes("application/json"))
      return r.json();
    return {
      bytes: Buffer.from(await r.arrayBuffer()),
      disposition: r.headers.get("content-disposition"),
    };
  };
  try {
    await start();
    await call("/register", {
      name: "Equipe Orçamentos",
      email: "modelos@example.com",
      password: "senha-modelos-123",
    });
    let data = await call("/data");
    assert.equal(data.quoteTemplates.length, 3);
    const settingsId = data.settings.id,
      packageId = data.packages[0].id;
    const client = await call("/records/clients", {
      name: "Cliente de Exemplo",
      email: "cliente@example.com",
    });
    const legacy = await call("/records/documents", {
      type: "quote",
      status: "draft",
      client,
      event: "Proposta anterior",
      date: "2027-05-20",
      packageName: "Pacote anterior",
      equipment: "Equipamento existente",
      total: 2700,
      extraHour: 500,
      payments: [],
    });
    await stop();
    await start();
    await call("/login", {
      email: "modelos@example.com",
      password: "senha-modelos-123",
    });
    data = await call("/data");
    assert.equal(data.settings.id, settingsId);
    assert.equal(data.packages[0].id, packageId);
    assert.equal(data.packages.length, 1);
    assert.equal(data.documents[0].id, legacy.id);
    assert.equal(data.clients[0].id, client.id);
    for (const template of QUOTE_TEMPLATES) {
      const offer = template.offers[0];
      const b = {
        type: "quote",
        status: "sent",
        client,
        templateId: template.id,
        offerId: offer.id,
        quoteHeadline: template.headline,
        introduction: template.introduction,
        quoteTemplate: { name: "Snapshot falso" },
        cashTotal: offer.cashPrice,
        installmentTotal: offer.installmentPrice,
        installmentCount: offer.installmentCount,
        paymentChoice: "installments",
        total: offer.installmentPrice,
        cardTerms: "Até 10x de R$ 319,90 no cartão.",
        paymentNotes:
          "À vista: parcela única na assinatura. Boleto: condições a combinar, com quitação até 10 dias antes do evento.",
        event: "Casamento de exemplo",
        date: "2027-07-03",
        venue: template.venue,
        packageName: offer.name,
        equipment: offer.equipment,
        extraHour: 500,
        payments: [],
        validUntil: "2027-06-10",
      };
      await call("/records/documents", { ...b, total: 100 }, 400);
      await call("/records/documents", { ...b, offerId: "nao-existe" }, 400);
      const quote = await call("/records/documents", b);
      assert.equal(quote.quoteTemplate.name, template.name);
      assert.equal(quote.quoteTemplate.offers[0].cashPrice, 2900);
      const pdf = await call(`/documents/${quote.id}/pdf?inline=1`);
      assert.equal(pdf.bytes.subarray(0, 5).toString(), "%PDF-");
      assert.match(pdf.disposition, /^inline;/);
      assert.ok(
        pdf.bytes.length > 100000,
        "PDF deve incorporar os assets do modelo",
      );
      const edited = await call("/records/documents", {
        ...quote,
        status: "approved",
        quoteTemplate: { name: "Não sobrescrever" },
      });
      assert.equal(edited.quoteTemplate.name, template.name);
      const contract = await call(`/documents/${quote.id}/convert`, {});
      assert.equal(contract.total, 3199);
      assert.match(contract.paymentNotes, /Pagamento parcelado no cartão/);
      assert.doesNotMatch(contract.paymentNotes, /À vista:/);
      assert.equal(contract.equipment, offer.equipment);
      assert.equal(contract.type, "contract");
      assert.match(contract.clauses, /OBJETO/);
      const contractPdf = await call(`/documents/${contract.id}/pdf`);
      assert.equal(contractPdf.bytes.subarray(0, 5).toString(), "%PDF-");
    }
    const castelli = QUOTE_TEMPLATES.find((t) => t.id === "castelli-mondini");
    for (const offer of castelli.offers.slice(1)) {
      const q = await call("/records/documents", {
        type: "quote",
        status: "draft",
        client,
        templateId: castelli.id,
        offerId: offer.id,
        cashTotal: offer.cashPrice,
        installmentTotal: offer.installmentPrice,
        installmentCount: offer.installmentCount,
        paymentChoice: "cash",
        total: offer.cashPrice,
        event: "Evento alternativo",
        date: "2027-05-20",
        packageName: offer.name,
        equipment: offer.equipment,
        payments: [],
      });
      assert.equal(q.total, offer.cashPrice);
      if (offer.installmentPrice == null)
        await call(
          "/records/documents",
          { ...q, paymentChoice: "installments" },
          400,
        );
    }
    const legacyPdf = await call(`/documents/${legacy.id}/pdf`);
    assert.equal(legacyPdf.bytes.subarray(0, 5).toString(), "%PDF-");
    assert.equal(dateBeforeEvent("2027-07-03"), "2027-06-23");
    assert.equal(dateBeforeEvent("2027-01-05"), "2026-12-26");
    assert.equal(dateBeforeEvent(""), "");
  } finally {
    if (child && child.exitCode === null) await stop();
    rmSync(dir, { recursive: true, force: true });
  }
});
