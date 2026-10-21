import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  migratePackageCatalog,
  parseLegacyEquipmentLine,
} from "../package-catalog.js";

const initialEquipment =
  "2 caixas de som\n2 caixas de grave\n2 microfones sem fio\n2 notebooks DJ\n1 controladora DJ\n1 mixer de 2 canais\n4 moving heads\n1 máquina de fumaça\n2 torres de treliça\nTransporte e montagem";
const schema = `CREATE TABLE records(id INTEGER PRIMARY KEY, user_id INTEGER, kind TEXT, body TEXT);`;
const put = (db, uid, kind, body) =>
  Number(db.prepare("INSERT INTO records(user_id,kind,body) VALUES(?,?,?)")
    .run(uid, kind, JSON.stringify(body)).lastInsertRowid);
const get = (db, id) => JSON.parse(db.prepare("SELECT body FROM records WHERE id=?").get(id).body);
const all = (db, uid, kind) => db.prepare("SELECT id,body FROM records WHERE user_id=? AND kind=? ORDER BY id")
  .all(uid, kind).map(({ id, body }) => ({ ...JSON.parse(body), id }));

test("migração interpreta quantidades claras sem consumir números de nomes e modelos", () => {
  assert.deepEqual(parseLegacyEquipmentLine("02 Caixas de som"), { name: "Caixas de som", qty: 2 });
  assert.deepEqual(parseLegacyEquipmentLine("3 x Microfone sem fio"), { name: "Microfone sem fio", qty: 3 });
  assert.deepEqual(parseLegacyEquipmentLine("1 máquina de fumaça"), { name: "máquina de fumaça", qty: 1 });
  assert.deepEqual(parseLegacyEquipmentLine("2 XLR balanceado"), { name: "XLR balanceado", qty: 2 });
  assert.deepEqual(parseLegacyEquipmentLine("2 Xone 96"), { name: "Xone 96", qty: 2 });
  for (const name of ["2 em 1", "2 em 1 iluminação", "2 canais estéreo", "200W Moving head", "1000 refletores", "0 caixas", "Transporte e montagem"])
    assert.deepEqual(parseLegacyEquipmentLine(name), { name, qty: 1 }, name);
});

test("pacote inicial antigo vira produtos sem alterar preço ou documentos, uma vez mesmo após reiniciar", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "aof-package-migration-"));
  const path = join(dir, "app.sqlite");
  let db = new DatabaseSync(path);
  t.after(() => { db.close(); rmSync(dir, { recursive: true, force: true }); });
  db.exec(schema);
  const original = {
    name: "Pacote 2 · Som & Luz",
    price: 2789.45,
    description: "Minha descrição preservada",
    equipment: initialEquipment,
  };
  const packageId = put(db, 1, "packages", original);
  const docId = put(db, 1, "documents", {
    type: "contract", equipment: initialEquipment, packageName: original.name,
    total: original.price, customData: { preserve: true },
  });
  const docBefore = db.prepare("SELECT body FROM records WHERE id=?").get(docId).body;
  migratePackageCatalog(db, 1);
  const migrated = get(db, packageId);
  assert.equal(migrated.name, original.name);
  assert.equal(migrated.price, original.price);
  assert.equal(migrated.description, original.description);
  assert.equal(migrated.catalogVersion, 1);
  assert.equal(migrated.equipmentExtra, "");
  assert.equal(migrated.legacyEquipment.equipment, original.equipment);
  assert.equal(migrated.items.length, 10);
  assert.deepEqual(migrated.items.map((item) => item.qty), [2, 2, 2, 2, 1, 1, 4, 1, 2, 1]);
  assert.deepEqual(migrated.items.map((item) => item.category), ["sound", "sound", "sound", "dj", "dj", "dj", "light", "light", "light", "other"]);
  const products = all(db, 1, "products");
  assert.equal(products.length, 10);
  for (const item of migrated.items) assert.ok(products.some((p) => p.id === item.productId));
  assert.equal(db.prepare("SELECT body FROM records WHERE id=?").get(docId).body, docBefore);
  const before = db.prepare("SELECT * FROM records ORDER BY id").all();
  migratePackageCatalog(db, 1);
  assert.deepEqual(db.prepare("SELECT * FROM records ORDER BY id").all(), before);
  db.close();
  db = new DatabaseSync(path);
  migratePackageCatalog(db, 1);
  assert.deepEqual(db.prepare("SELECT * FROM records ORDER BY id").all(), before);
});

test("pacotes mistos preservam snapshots, reutilizam produtos da conta e não duplicam itens", (t) => {
  const db = new DatabaseSync(":memory:");
  t.after(() => db.close());
  db.exec(schema);
  const existingId = put(db, 1, "products", { name: "Microfone especial", category: "ceremony", price: 123.45 });
  const sharedNameId = put(db, 2, "products", { name: "Produto exclusivo", category: "media", price: 500 });
  const snapshot = { productId: existingId, name: "Nome gravado antes da edição", category: "sound", price: 90, qty: 2 };
  const source = {
    name: "Pacote misto", price: 900, description: "Festa",
    items: [snapshot], equipment: "02 Nome gravado antes da edição\n3 Microfone especial\nProduto exclusivo",
    equipmentExtra: "3 Microfone especial\nProduto exclusivo\n2 em 1",
  };
  const packageId = put(db, 1, "packages", source);
  const otherPackageId = put(db, 2, "packages", { name: "Outra conta", price: 10, equipment: "Produto exclusivo" });
  const otherBefore = db.prepare("SELECT body FROM records WHERE id=?").get(otherPackageId).body;
  migratePackageCatalog(db, 1);
  const migrated = get(db, packageId);
  assert.deepEqual(migrated.items[0], snapshot);
  assert.equal(migrated.items.length, 4);
  assert.equal(migrated.items[1].productId, existingId);
  assert.equal(migrated.items[1].qty, 3);
  assert.equal(migrated.items[1].category, "ceremony");
  assert.equal(migrated.items[1].price, 123.45);
  assert.notEqual(migrated.items[2].productId, sharedNameId);
  assert.equal(migrated.items[2].category, "other");
  assert.equal(migrated.items[3].name, "2 em 1");
  assert.equal(migrated.items[3].qty, 1);
  assert.equal(migrated.legacyEquipment.equipmentExtra, source.equipmentExtra);
  assert.equal(db.prepare("SELECT body FROM records WHERE id=?").get(otherPackageId).body, otherBefore);
  const productsBefore = all(db, 1, "products");
  migratePackageCatalog(db, 1);
  assert.deepEqual(all(db, 1, "products"), productsBefore);
  // Uma exclusão intencional posterior não deve recriar o cadastro na leitura.
  db.prepare("DELETE FROM records WHERE id=?").run(existingId);
  migratePackageCatalog(db, 1);
  assert.equal(db.prepare("SELECT id FROM records WHERE id=?").get(existingId), undefined);
  assert.deepEqual(get(db, packageId), migrated);
});

test("falha na migração desfaz tanto produtos quanto pacotes da transação", (t) => {
  const db = new DatabaseSync(":memory:");
  t.after(() => db.close());
  db.exec(schema);
  put(db, 1, "packages", { name: "Pacote", price: 100, equipment: "Produto um\nProduto dois" });
  db.exec(`CREATE TRIGGER reject_second_product BEFORE INSERT ON records
    WHEN NEW.kind='products' AND json_extract(NEW.body, '$.name')='Produto dois'
    BEGIN SELECT RAISE(ABORT, 'falha de teste'); END;`);
  const before = db.prepare("SELECT * FROM records ORDER BY id").all();
  assert.throws(() => migratePackageCatalog(db, 1), /falha de teste/);
  assert.deepEqual(db.prepare("SELECT * FROM records ORDER BY id").all(), before);
  db.exec("DROP TRIGGER reject_second_product");
  migratePackageCatalog(db, 1);
  assert.equal(all(db, 1, "products").length, 2);
});

test("API monta pacotes com produtos da conta, migra legados e conserva snapshots existentes", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "aof-package-api-"));
  const child = spawn(process.execPath, ["server.js"], {
    env: { ...process.env, PORT: "3041", DATA_DIR: dir, AOF_OPEN_BROWSER: "0", AOF_DESKTOP: "0" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  t.after(async () => {
    if (child.exitCode === null) {
      const ended = new Promise((resolve) => child.once("exit", resolve));
      child.kill(); await ended;
    }
    rmSync(dir, { recursive: true, force: true });
  });
  await new Promise((resolve, reject) => {
    child.stdout.once("data", resolve);
    child.once("error", reject);
    child.once("exit", (code) => reject(Error(`Servidor encerrou: ${code}`)));
  });
  let cookie = "";
  const call = async (path, body, expected = 200, method) => {
    const response = await fetch(`http://127.0.0.1:3041/api${path}`, {
      method: method || (body ? "POST" : "GET"),
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: body ? JSON.stringify(body) : undefined,
    });
    assert.equal(response.status, expected, `${path}: ${response.status}`);
    if (response.headers.get("set-cookie")) cookie = response.headers.get("set-cookie").split(";")[0];
    return response.json();
  };
  const account = { name: "Pacotes", email: "pacotes@example.test", password: "senha-pacotes-123" };
  const user = await call("/register", account);
  const ownCookie = cookie;
  const product = await call("/records/products", { name: "Microfone X", category: "ceremony", price: 150 });
  const validItem = { productId: product.id, name: product.name, category: product.category, price: product.price, qty: 3 };
  const base = { name: "Pacote personalizado", price: 700, description: "Pacote montado", items: [validItem] };
  const saved = await call("/records/packages", { ...base, equipment: "Texto falso a ignorar", legacyEquipment: { equipment: "Não aceitar backup do cliente" } });
  assert.equal(saved.catalogVersion, 1);
  assert.equal(saved.equipment, "03 Microfone X");
  assert.equal(saved.equipmentExtra, "");
  assert.equal(saved.legacyEquipment, undefined);
  assert.equal(saved.price, 700);
  assert.deepEqual(saved.items, [validItem]);
  const minimal = await call("/records/packages", {
    name: "Pacote com referência", price: 350,
    items: [{ productId: product.id, qty: 2 }],
  });
  assert.deepEqual(minimal.items, [{ ...validItem, qty: 2 }]);
  assert.equal(minimal.equipment, "02 Microfone X");
  await call("/records/packages", { ...base, items: [] }, 400);
  await call("/records/packages", { name: "Somente texto", price: 50, equipment: "01 DJ" }, 400);
  await call("/records/packages", { ...base, equipmentExtra: "01 DJ" }, 400);
  for (const productId of [null, 999999])
    await call("/records/packages", { ...base, items: [{ ...validItem, productId }] }, 400);
  await call("/register", { ...account, email: "outra-conta@example.test" });
  const foreign = await call("/records/products", { name: "Produto privado", category: "light", price: 999 });
  cookie = ownCookie;
  await call("/records/packages", { ...base, items: [{ ...validItem, productId: foreign.id }] }, 400);
  await call("/records/products", { ...product, name: "Microfone renomeado", category: "sound", price: 999 });
  const preserved = await call("/records/packages", { ...saved, description: "Descrição revisada" });
  assert.deepEqual(preserved.items, saved.items);
  assert.equal(preserved.equipment, saved.equipment);
  await call(`/records/products/${product.id}`, null, 200, "DELETE");
  const afterDelete = await call("/records/packages", { ...preserved, price: 750 });
  assert.deepEqual(afterDelete.items, saved.items);
  await call("/records/packages", base, 400);
  // Banco temporário de uma versão antiga; /data precisa executar a conversão.
  const fixtureDb = new DatabaseSync(join(dir, "app.sqlite"));
  const legacyId = put(fixtureDb, user.id, "packages", { name: "Legado da API", price: 55, equipment: "2 Produto legado" });
  fixtureDb.close();
  const data = await call("/data");
  const legacy = data.packages.find((p) => p.id === legacyId);
  assert.equal(legacy.items.length, 1);
  assert.equal(legacy.items[0].qty, 2);
  assert.ok(data.products.some((p) => p.id === legacy.items[0].productId));
  assert.equal(legacy.price, 55);
  assert.equal(data.products.some((p) => p.id === product.id), false);
});
