import { test } from "node:test";
import assert from "node:assert/strict";
import {
  existsSync,
  linkSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { importData } from "../install-windows.js";

const schema = `
  CREATE TABLE users(id INTEGER PRIMARY KEY, name TEXT, email TEXT UNIQUE, salt TEXT, hash TEXT);
  CREATE TABLE sessions(token TEXT PRIMARY KEY, user_id INTEGER, expires INTEGER);
  CREATE TABLE records(id INTEGER PRIMARY KEY, user_id INTEGER, kind TEXT, body TEXT);
`;

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), "aof-import-test-"));
  const destination = join(root, "destination");
  mkdirSync(destination);
  const originalDataDir = process.env.DATA_DIR;
  process.env.DATA_DIR = destination;
  t.after(() => {
    if (originalDataDir === undefined) delete process.env.DATA_DIR;
    else process.env.DATA_DIR = originalDataDir;
    rmSync(root, { recursive: true, force: true });
  });
  return { root, destination, target: join(destination, "app.sqlite") };
}

function createDatabase(file, labels, { keepOpen = false } = {}) {
  const db = new DatabaseSync(file);
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA wal_autocheckpoint=0; ${schema}`);
  db.prepare("INSERT INTO users(name,email,salt,hash) VALUES(?,?,?,?)").run(
    "Teste",
    "teste@example.com",
    "salt-teste",
    "hash-teste",
  );
  for (const label of labels)
    db.prepare(
      "INSERT INTO records(user_id,kind,body) VALUES(1,'documents',?)",
    ).run(JSON.stringify({ label }));
  if (keepOpen) return db;
  db.close();
}

function labels(file) {
  const db = new DatabaseSync(file, { readOnly: true });
  try {
    return db
      .prepare("SELECT body FROM records ORDER BY id")
      .all()
      .map(({ body }) => JSON.parse(body).label);
  } finally {
    db.close();
  }
}

test("importação rejeita origem corrompida sem modificar o banco atual", async (t) => {
  const { root, target, destination } = fixture(t);
  createDatabase(target, ["contrato-original"]);
  const before = readFileSync(target);
  const source = join(root, "corrompido.sqlite");
  writeFileSync(source, "isto nao e um banco SQLite");

  await assert.rejects(importData(source), /importação não foi concluída/i);

  assert.deepEqual(readFileSync(target), before);
  assert.deepEqual(readdirSync(destination), ["app.sqlite"]);
  assert.deepEqual(labels(target), ["contrato-original"]);
});

test("importação rejeita SQLite sem o esquema completo antes de substituir dados", async (t) => {
  const { root, target, destination } = fixture(t);
  createDatabase(target, ["contrato-original"]);
  const before = readFileSync(target);
  const source = join(root, "incompativel.sqlite");
  const db = new DatabaseSync(source);
  db.exec(
    "CREATE TABLE records(id INTEGER PRIMARY KEY, user_id INTEGER, kind TEXT, body TEXT)",
  );
  db.close();

  await assert.rejects(importData(source), /banco compatível/i);

  assert.deepEqual(readFileSync(target), before);
  assert.deepEqual(readdirSync(destination), ["app.sqlite"]);
  assert.deepEqual(labels(target), ["contrato-original"]);
});

test("importação traz dados ainda no WAL e guarda backup consistente do destino", async (t) => {
  const { root, target, destination } = fixture(t);
  createDatabase(target, ["contrato-anterior"]);
  const source = join(root, "origem.sqlite");
  const sourceDb = createDatabase(source, ["primeiro", "segundo"], {
    keepOpen: true,
  });
  try {
    assert.ok(existsSync(`${source}-wal`));
    assert.ok(statSync(`${source}-wal`).size > 0);

    await importData(source);

    assert.deepEqual(labels(target), ["primeiro", "segundo"]);
    const backups = readdirSync(destination).filter((name) =>
      name.endsWith(".bak"),
    );
    assert.equal(backups.length, 1);
    assert.deepEqual(labels(join(destination, backups[0])), [
      "contrato-anterior",
    ]);
    assert.equal(
      sourceDb.prepare("SELECT COUNT(*) AS n FROM records").get().n,
      2,
    );
    assert.equal(
      readdirSync(destination).some((name) => name.startsWith(".aof-import-")),
      false,
    );
  } finally {
    sourceDb.close();
  }
});

test("importação recusa destino aberto em WAL e preserva os dados", async (t) => {
  const { root, target, destination } = fixture(t);
  const targetDb = createDatabase(target, ["contrato-em-uso"], {
    keepOpen: true,
  });
  const source = join(root, "origem.sqlite");
  createDatabase(source, ["substituto"]);
  try {
    await assert.rejects(importData(source), /Feche o AOF Studio/i);

    assert.equal(
      targetDb.prepare("SELECT body FROM records").get().body,
      JSON.stringify({ label: "contrato-em-uso" }),
    );
    assert.deepEqual(labels(target), ["contrato-em-uso"]);
    assert.equal(
      readdirSync(destination).some(
        (name) => name.endsWith(".bak") || name.startsWith(".aof-import-"),
      ),
      false,
    );
  } finally {
    targetDb.close();
  }
});

test("primeira importação aceita a pasta data e não exige registros existentes", async (t) => {
  const { root, target, destination } = fixture(t);
  const sourceDir = join(root, "source-data");
  mkdirSync(sourceDir);
  createDatabase(join(sourceDir, "app.sqlite"), []);

  await importData(sourceDir);

  assert.deepEqual(labels(target), []);
  assert.equal(
    readdirSync(destination).some(
      (name) => name.endsWith(".bak") || name.startsWith(".aof-import-"),
    ),
    false,
  );
});

test("origem igual ao destino por link físico é recusada", async (t) => {
  const { root, target } = fixture(t);
  createDatabase(target, ["original"]);
  const alias = join(root, "alias.sqlite");
  linkSync(target, alias);

  await assert.rejects(importData(alias), /mesmo arquivo/i);

  assert.deepEqual(labels(target), ["original"]);
});
