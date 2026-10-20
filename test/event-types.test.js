import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EVENT_TYPES } from "../public/event-types.js";

test("tipo de evento persiste, valida opções e acompanha a conversão sem alterar documentos antigos", async () => {
  const dir = mkdtempSync(join(tmpdir(), "aof-events-"));
  let child;
  const start = async () => {
    child = spawn(process.execPath, ["server.js"], {
      env: { ...process.env, PORT: "3036", DATA_DIR: dir, AOF_OPEN_BROWSER: "0", AOF_DESKTOP: "0" },
      stdio: ["ignore", "pipe", "pipe"],
    });
    await new Promise((resolve, reject) => {
      child.stdout.once("data", resolve);
      child.once("error", reject);
      child.once("exit", (code) => reject(Error(`Servidor encerrou: ${code}`)));
    });
  };
  const stop = async () => {
    const closed = new Promise((resolve) => child.once("exit", resolve));
    child.kill();
    await closed;
  };
  let cookie = "";
  const call = async (path, body, expected = 200) => {
    const response = await fetch(`http://127.0.0.1:3036/api${path}`, {
      method: body ? "POST" : "GET",
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: body ? JSON.stringify(body) : undefined,
    });
    assert.equal(response.status, expected, path);
    if (response.headers.get("set-cookie")) cookie = response.headers.get("set-cookie").split(";")[0];
    return response.json();
  };
  try {
    await start();
    const account = { name: "Eventos", email: "eventos@example.test", password: "senha-eventos-123" };
    await call("/register", account);
    const data = await call("/data");
    assert.deepEqual(data.eventTypes, EVENT_TYPES);
    assert.deepEqual(data.eventTypes.map((eventType) => eventType.id), ["casamento", "debutante", "aniversario", "formatura"]);
    const client = await call("/records/clients", { name: "Cliente de eventos" });
    const base = { type: "quote", status: "draft", client, event: "Celebração", date: "2027-09-18", packageName: "DJ e iluminação", equipment: "01 DJ", total: 2000, payments: [] };
    const legacy = await call("/records/documents", base);
    assert.equal(legacy.eventType, null);
    for (const invalid of ["outro", "../casamento.jpg", [], {}, 123, false]) {
      await call("/records/documents", { ...base, eventType: invalid }, 400);
    }
    const documents = [];
    for (const eventType of EVENT_TYPES) {
      const quote = await call("/records/documents", { ...base, eventType: eventType.id });
      assert.equal(quote.eventType, eventType.id);
      const contract = await call(`/documents/${quote.id}/convert`, {});
      assert.equal(contract.eventType, eventType.id);
      assert.equal(contract.total, base.total);
      documents.push(quote);
    }
    const changed = await call("/records/documents", { ...documents[0], eventType: "formatura" });
    assert.equal(changed.eventType, "formatura");
    assert.equal(changed.equipment, base.equipment);
    const oldClientPayload = { ...changed, notes: "Ajuste de observação" };
    delete oldClientPayload.eventType;
    const preserved = await call("/records/documents", oldClientPayload);
    assert.equal(preserved.eventType, "formatura");
    await stop();
    await start();
    await call("/login", account);
    const reloaded = await call("/data");
    assert.equal(reloaded.documents.find((doc) => doc.id === changed.id).eventType, "formatura");
    const previous = reloaded.documents.find((doc) => doc.id === legacy.id);
    assert.equal(previous.eventType, null);
    assert.equal((await call("/records/documents", { ...previous, notes: "Revisado" })).eventType, null);
  } finally {
    if (child && child.exitCode === null) await stop();
    rmSync(dir, { recursive: true, force: true });
  }
});
