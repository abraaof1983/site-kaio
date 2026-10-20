import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { validateLogos, logoBuffer, MAX_LOGO_BYTES } from "../branding.js";
const fixture =
  "data:image/jpeg;base64," +
  readFileSync(
    new URL("../public/quote-assets/logo.jpg", import.meta.url),
  ).toString("base64");

test("logos aceitam raster local válido e rejeitam dados inválidos ou grandes", () => {
  assert.equal(
    validateLogos({ quoteLogoDataUrl: fixture, contractLogoDataUrl: fixture }),
    null,
  );
  assert.equal(logoBuffer(fixture).length, 97403);
  assert.equal(
    validateLogos({ quoteLogoDataUrl: null, contractLogoDataUrl: "" }),
    null,
  );
  for (const value of [
    "https://example.com/logo.png",
    "data:image/svg+xml;base64,PHN2Zz4=",
    "data:image/png;base64,YmFk",
    `data:image/jpeg;base64,${Buffer.alloc(MAX_LOGO_BYTES + 1).toString("base64")}`,
  ])
    assert.ok(validateLogos({ quoteLogoDataUrl: value }));
});

test("logos por conta são preservados nos documentos e não substituem identidade histórica", async () => {
  const dir = mkdtempSync(join(tmpdir(), "aof-branding-"));
  const child = spawn(process.execPath, ["server.js"], {
    env: {
      ...process.env,
      PORT: "3033",
      DATA_DIR: dir,
      AOF_OPEN_BROWSER: "0",
      AOF_DESKTOP: "0",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  try {
    await new Promise((resolve, reject) => {
      child.stdout.once("data", resolve);
      child.once("error", reject);
      child.once("exit", (code) => reject(Error("Servidor encerrou: " + code)));
    });
    let cookie = "";
    const call = async (path, body, expected = 200) => {
      const r = await fetch("http://127.0.0.1:3033/api" + path, {
        method: body ? "POST" : "GET",
        headers: { "Content-Type": "application/json", Cookie: cookie },
        body: body ? JSON.stringify(body) : undefined,
      });
      assert.equal(r.status, expected, path);
      if (r.headers.get("set-cookie"))
        cookie = r.headers.get("set-cookie").split(";")[0];
      return r.headers.get("content-type")?.includes("application/json")
        ? r.json()
        : Buffer.from(await r.arrayBuffer());
    };
    for (const path of [
      "/package.json",
      "/..%5cpackage.json",
      "/..%5cdata%5capp.sqlite",
      "/%2e%2e%5cserver.js",
    ]) {
      const r = await fetch("http://127.0.0.1:3033" + path);
      assert.equal(
        r.status,
        404,
        "Recursos fora de public não podem ser servidos",
      );
    }
    await call("/register", {
      name: "Marca de Teste",
      email: "marca@example.com",
      password: "senha-teste-logo123",
    });
    let data = await call("/data");
    await call(
      "/records/settings",
      { ...data.settings, quoteLogoDataUrl: "data:image/png;base64,YmFk" },
      400,
    );
    await call("/records/settings", {
      ...data.settings,
      company: "Marca Personalizada",
      quoteLogoDataUrl: fixture,
      contractLogoDataUrl: fixture,
    });
    data = await call("/data");
    assert.equal(data.settings.quoteLogoDataUrl, fixture);
    const client = await call("/records/clients", { name: "Cliente de Teste" });
    const quote = await call("/records/documents", {
      type: "quote",
      status: "draft",
      client,
      event: "Evento de Teste",
      date: "2027-08-14",
      packageName: "Pacote de Teste",
      equipment: "01 DJ",
      total: 1200,
      extraHour: 0,
      payments: [],
    });
    assert.equal(quote.company.quoteLogoDataUrl, fixture);
    const legacy = { ...data.settings };
    delete legacy.quoteLogoDataUrl;
    delete legacy.contractLogoDataUrl;
    await call("/records/settings", legacy);
    assert.equal((await call("/data")).settings.contractLogoDataUrl, fixture);
    await call("/records/settings", {
      ...data.settings,
      quoteLogoDataUrl: null,
      contractLogoDataUrl: null,
    });
    const current = await call("/data");
    assert.equal(current.settings.quoteLogoDataUrl, null);
    assert.equal(current.documents[0].company.quoteLogoDataUrl, fixture);
    const contract = await call(`/documents/${quote.id}/convert`, {});
    assert.equal(contract.company.contractLogoDataUrl, fixture);
    for (const d of [quote, contract]) {
      const pdf = await call(`/documents/${d.id}/pdf`);
      assert.equal(pdf.subarray(0, 5).toString(), "%PDF-");
      assert.ok(pdf.includes(Buffer.from("/Subtype /Image")));
    }
    const ownCookie = cookie;
    await call("/register", {
      name: "Outra Marca",
      email: "outra-marca@example.com",
      password: "senha-outra-logo123",
    });
    assert.equal((await call("/data")).settings.quoteLogoDataUrl, null);
    await call(`/documents/${quote.id}/pdf`, null, 404);
    cookie = ownCookie;
    assert.equal(
      (await call("/data")).documents.find((d) => d.id === quote.id).company
        .company,
      "Marca Personalizada",
    );
  } finally {
    const stopped = new Promise((resolve) => child.once("exit", resolve));
    child.kill();
    await stopped;
    rmSync(dir, { recursive: true, force: true });
  }
});
