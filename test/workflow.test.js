import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
test("cadastro, isolamento, orçamento, contrato, parcelas e PDF", async () => {
  const dir = mkdtempSync(join(tmpdir(), "aof-test-"));
  const child = spawn(process.execPath, ["server.js"], {
    env: { ...process.env, PORT: "3011", DATA_DIR: dir },
    stdio: ["ignore", "pipe", "pipe"],
  });
  try {
    await new Promise((resolve, reject) => {
      child.stdout.once("data", resolve);
      child.once("error", reject);
      child.once("exit", (c) => reject(Error("Servidor encerrou: " + c)));
    });
    let cookie = "";
    const call = async (path, body, expected = 200) => {
      const r = await fetch("http://127.0.0.1:3011/api" + path, {
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
    await call("/data", null, 401);
    await call("/register", {
      name: "Conta Teste",
      email: "teste@example.com",
      password: "senha-teste-123",
    });
    let data = await call("/data");
    assert.equal(data.packages.length, 1);
    assert.match(data.settings.clauses, /MONTAGEM/);
    const client = await call("/records/clients", {
      name: "Cliente de Teste",
      email: "cliente@example.com",
      document: "Dado de teste",
      address: "Endereço de teste",
    });
    const body = {
      type: "quote",
      status: "draft",
      client,
      clientId: String(client.id),
      event: "Celebração de teste",
      date: "2027-05-20",
      venue: "Espaço de teste",
      packageName: "Pacote de teste",
      equipment: "Som e iluminação",
      total: 2700,
      extraHour: 500,
      payments: [
        { date: "2027-01-01", amount: 1350 },
        { date: "2027-05-01", amount: 1350 },
      ],
      clauses: data.settings.clauses,
    };
    await call(
      "/records/documents",
      { ...body, payments: [{ date: "2027-01-01", amount: 100 }] },
      400,
    );
    const quote = await call("/records/documents", body);
    assert.match(quote.number, /^OR-/);
    const contract = await call(`/documents/${quote.id}/convert`, {});
    assert.equal(contract.type, "contract");
    assert.match(contract.number, /^CT-/);
    const duplicate = await call(`/documents/${quote.id}/convert`, {});
    assert.equal(contract.id, duplicate.id);
    const pdf = await call(`/documents/${contract.id}/pdf`);
    assert.equal(pdf.subarray(0, 5).toString(), "%PDF-");
    writeFileSync("/tmp/aof-contract-test.pdf", pdf);
    const settings = await call("/records/settings", {
      ...data.settings,
      company: "Outro nome",
    });
    data = await call("/data");
    assert.equal(
      data.documents.find((x) => x.id === contract.id).company.company,
      "AOF Serviços",
    );
    await call("/logout", {});
    await call(
      "/login",
      { email: "teste@example.com", password: "errada" },
      401,
    );
    await call("/login", {
      email: "teste@example.com",
      password: "senha-teste-123",
    });
    await call("/register", {
      name: "Outra Conta",
      email: "outra@example.com",
      password: "outra-senha-123",
    });
    assert.equal((await call("/data")).documents.length, 0);
    await call(`/documents/${contract.id}/pdf`, null, 404);
    await call("/records/documents", { ...contract, event: "Tentativa" }, 404);
  } finally {
    child.kill();
    await new Promise((resolve) => child.once("exit", resolve));
    rmSync(dir, { recursive: true, force: true });
  }
});
