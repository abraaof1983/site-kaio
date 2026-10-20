import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, realpathSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";

// Confere o executável já compilado. O empacotamento falha em silêncio: uma
// leitura de disco nova, um recurso esquecido ou um caminho relativo só aparecem
// quando o programa roda fora do projeto. Uso: npm run verify:exe
const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const APP_NAME = "AOF Studio";
const EXE = join(root, "dist", APP_NAME, `${APP_NAME}.exe`);
const PORT = "3091";
const results = [];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const check = (name, ok, detail = "") => {
  results.push({ name, ok: Boolean(ok) });
  console.log(`${ok ? "OK  " : "FALHOU"} ${name}${detail ? ` — ${detail}` : ""}`);
};
const kb = (bytes) => `${(bytes / 1024).toFixed(0)} KB`;

if (!existsSync(EXE)) {
  console.error(`Não encontrei ${EXE}.\nCompile antes com: npm run build:exe`);
  process.exit(1);
}

// A verificação não pode herdar PORT, DATA_DIR e afins do terminal: o resultado
// precisa valer independentemente de como o ambiente de quem executa está.
const baseEnv = { ...process.env };
for (const name of ["PORT", "HOST", "DATA_DIR", "AOF_OPEN_BROWSER", "AOF_VERSION", "COOKIE_SECURE"])
  delete baseEnv[name];

function cli(args, env = {}) {
  const r = spawnSync(EXE, args, { env: { ...baseEnv, ...env }, encoding: "utf8", windowsHide: true });
  return { out: (r.stdout || "") + (r.stderr || ""), status: r.status };
}
// Valores vão por variável de ambiente, e não interpolados no texto do script:
// caminhos com espaço e aspas deixam de ser problema.
const ps = (script, env = {}) => {
  const r = spawnSync("powershell", ["-NoProfile", "-NonInteractive", "-Command", script], {
    env: { ...baseEnv, ...env },
    encoding: "utf8",
    windowsHide: true,
  });
  return (r.stdout || "").trim() || (r.stderr || "").trim().split("\n")[0] || "";
};
const records = (file) => {
  const db = new DatabaseSync(file, { readOnly: true });
  try {
    return db.prepare("SELECT COUNT(*) AS n FROM records").get().n;
  } finally {
    db.close();
  }
};

function startExe(env) {
  const child = spawn(EXE, [], {
    env: { ...baseEnv, AOF_OPEN_BROWSER: "0", ...env },
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  let out = "";
  let closed = false;
  let code = null;
  child.stdout.on("data", (d) => (out += d));
  child.stderr.on("data", (d) => (out += d));
  const exited = new Promise((r) =>
    child.once("exit", (status) => {
      closed = true;
      code = status;
      r();
    }),
  );
  return {
    exited,
    code: () => code,
    text: () => out,
    async waitFor(match, ms = 30000) {
      const end = Date.now() + ms;
      while (Date.now() < end) {
        if (match.test(out)) return true;
        if (closed) return match.test(out);
        await sleep(150);
      }
      return false;
    },
    async stop() {
      if (closed) return;
      child.kill();
      await exited;
    },
  };
}

const dataDir = mkdtempSync(join(tmpdir(), "aof-verify-"));
const fakeHome = mkdtempSync(join(tmpdir(), "aof-home-"));
const importDir = mkdtempSync(join(tmpdir(), "aof-import-"));
const desktop = ps("[Environment]::GetFolderPath('Desktop')");
const programs = ps("[Environment]::GetFolderPath('Programs')");
const links = [join(desktop, `${APP_NAME}.lnk`), join(programs, `${APP_NAME}.lnk`)];
// Atalhos que já existiam antes da verificação: sinal de instalação real nesta
// máquina, que não pode ser mexida.
const installedHere = links.filter((link) => existsSync(link));
let touchedLinks = false;
let app;

try {
  console.log(`\n--- Programa (${(statSync(EXE).size / 1048576).toFixed(1)} MB) ---`);
  const version = cli(["--versao"]);
  check("--versao responde", version.status === 0 && /AOF Studio \d+\.\d+\.\d+/.test(version.out), version.out.trim());
  check("--ajuda lista os comandos", /--instalar/.test(cli(["--ajuda"]).out));
  const where = cli(["--pasta-dados"]);
  check(
    "banco fica no perfil do usuário",
    where.out.trim() === join(process.env.LOCALAPPDATA, APP_NAME, "data"),
    where.out.trim(),
  );
  check("comando desconhecido avisa e falha", cli(["--banana"]).status === 1);
  const info = ps(`$i = (Get-Item -LiteralPath $env:AOF_EXE).VersionInfo; "$($i.ProductName)|$($i.ProductVersion)"`, { AOF_EXE: EXE });
  check("propriedades do arquivo preenchidas", info.startsWith(APP_NAME), info);
  // A compilação remove a assinatura do node.exe, porque alterar o binário a
  // invalida. "NotSigned" é o esperado; uma assinatura que não confere
  // ("HashMismatch") é o problema de verdade, tratada por antivírus como
  // adulteração. Quando o Windows não consegue responder, o resultado é
  // inconclusivo e não deve reprovar uma publicação.
  const signature = ps(
    `try { (Get-AuthenticodeSignature -LiteralPath $env:AOF_EXE).Status } catch { "erro: " + $_.Exception.Message }`,
    { AOF_EXE: EXE },
  );
  if (["NotSigned", "Valid"].includes(signature)) check("sem assinatura quebrada", true, signature);
  else if (/mismatch|NotTrusted|NotSupportedFileFormat/i.test(signature)) check("sem assinatura quebrada", false, signature);
  else console.log(`PULADO: o Windows não informou a assinatura do executável (${signature || "sem resposta"})`);

  console.log("\n--- Servidor e dados locais ---");
  app = startExe({ PORT, DATA_DIR: dataDir });
  check("sobe e anuncia o endereço", await app.waitFor(new RegExp(`http://localhost:${PORT}`)), app.text().trim().split("\n")[0]);
  check("informa a pasta de dados", (await app.waitFor(/Dados em /)) && app.text().includes(dataDir));

  const base = `http://127.0.0.1:${PORT}`;
  let cookie = "";
  const api = async (path, body, expected = 200) => {
    const r = await fetch(`${base}/api${path}`, {
      method: body ? "POST" : "GET",
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (r.headers.get("set-cookie")) cookie = r.headers.get("set-cookie").split(";")[0];
    const payload = (r.headers.get("content-type") || "").includes("json")
      ? await r.json()
      : Buffer.from(await r.arrayBuffer());
    if (r.status !== expected) throw Error(`${path}: status ${r.status}, esperava ${expected}`);
    return payload;
  };
  check("responde só em 127.0.0.1", await (async () => {
    // O endereço da máquina na rede não deve aceitar conexão.
    const lan = ps("(Get-NetIPAddress -AddressFamily IPv4 | Where-Object { $_.IPAddress -notlike '127.*' } | Select-Object -First 1).IPAddress");
    if (!lan) return true;
    try {
      await fetch(`http://${lan}:${PORT}/api/health`, { signal: AbortSignal.timeout(2500) });
      return false;
    } catch {
      return true;
    }
  })(), "conexão pela rede recusada");
  check("/api/health identifica o sistema", (await api("/health")).app === "aof-studio");
  await api("/data", null, 401);
  check("dados exigem login", true);
  await api("/register", { name: "Verificação", email: `v-${Date.now()}@example.com`, password: "senha-teste-123" });
  const data = await api("/data");
  check("conta nova com pacote e cláusulas", data.packages.length === 1 && /MONTAGEM/.test(data.settings.clauses));
  check("modelos de orçamento embutidos", data.quoteTemplates.length >= 3, `${data.quoteTemplates.length} modelos`);

  const client = await api("/records/clients", {
    name: "Cliente de Verificação", document: "000.000.000-00", email: "c@example.com",
    phone: "(47) 90000-0000", address: "Rua Teste, 1, Blumenau, SC, 89000-000",
  });
  const contract = await api("/records/documents", {
    type: "contract", status: "draft", clientId: String(client.id), client,
    event: "Casamento de Verificação", date: "2027-05-15", venue: "Espaço Teste", guests: "100",
    setup: "12:00", ceremony: "16:00", start: "19:00", end: "04:00", referral: "Instagram",
    packageName: "Pacote completo", equipment: "04 Moving heads Beam 200\n02 Caixas de som\n01 Mesa controladora DJ",
    total: 3000, extraHour: 500, payments: [], paymentNotes: "PIX.", notes: "Observação.", imageConsent: true,
    clauses: "1. OBJETO E SERVIÇOS\nServiços de DJ.\n\n2. ALIMENTAÇÃO\nO contratante fornece alimentação.",
  });
  const contractPdf = await api(`/documents/${contract.id}/pdf`);
  check(
    "PDF do contrato com as fontes embutidas",
    contractPdf.subarray(0, 5).toString() === "%PDF-" && contractPdf.toString("latin1").includes("DejaVuSans"),
    kb(contractPdf.length),
  );
  const template = data.quoteTemplates[1];
  const quote = await api("/records/documents", {
    type: "quote", status: "draft", clientId: String(client.id), client,
    event: "Casamento de Verificação", date: "2027-05-15", venue: "Espaço Teste",
    templateId: template.id, offerId: template.offers[0].id,
    cashTotal: 3900, installmentTotal: 4199, installmentCount: 5, paymentChoice: "cash",
    packageName: "Pacote completo", equipment: "02 Caixas de som", total: 3900,
    extraHour: 500, payments: [], validUntil: "2026-12-01",
  });
  const quotePdf = await api(`/documents/${quote.id}/pdf`);
  check("PDF do orçamento com a imagem embutida", quotePdf.length > 150000, kb(quotePdf.length));

  const page = async (path, headers = {}) => {
    const r = await fetch(`${base}${path}`, { headers: { Cookie: cookie, ...headers } });
    return { status: r.status, type: r.headers.get("content-type"), etag: r.headers.get("etag"), body: Buffer.from(await r.arrayBuffer()) };
  };
  const index = await page("/");
  check("tela inicial vem do executável", index.status === 200 && index.type?.includes("text/html") && index.body.length > 0, kb(index.body.length));
  for (const [path, type] of [
    ["/app.js", "javascript"], ["/style.css", "text/css"], ["/formatters.js", "javascript"],
    ["/routes.js", "javascript"], ["/documents.js", "javascript"], ["/quote-templates.js", "javascript"],
    ["/catalog.js", "javascript"],
    ["/quote-assets/logo-contrato.jpg", "image/jpeg"], ["/quote-assets/logo-aof.jpg", "image/jpeg"],
    ["/quote-assets/estrutura.png", "image/png"],
  ]) {
    const r = await page(path);
    check(`serve ${path}`, r.status === 200 && r.type?.includes(type) && r.body.length > 0, `${r.type} ${kb(r.body.length)}`);
  }
  const css = await page("/style.css");
  check("revalida com ETag", (await page("/style.css", { "If-None-Match": css.etag })).status === 304);
  for (const path of ["/../package.json", "/..%2fpackage.json", "/%2e%2e/server.js", "/quote-assets/../../server.js"]) {
    const r = await page(path);
    check(`bloqueia ${path}`, r.status === 404 || r.status === 400, `status ${r.status}`);
  }
  check("arquivo inexistente dá 404", (await page("/nao-existe.js")).status === 404);
  check("banco criado na pasta indicada", existsSync(join(dataDir, "app.sqlite")), kb(statSync(join(dataDir, "app.sqlite")).size));
  await app.stop();

  console.log("\n--- Uma janela só ---");
  const first = startExe({ DATA_DIR: dataDir });
  const up = await first.waitFor(/http:\/\/localhost:(\d+)/);
  const port = first.text().match(/http:\/\/localhost:(\d+)/)?.[1];
  check("escolhe a porta livre sozinho", up && Boolean(port), `porta ${port}`);
  const second = startExe({ DATA_DIR: dataDir });
  const reused = await second.waitFor(/já está aberto/, 25000);
  await second.exited;
  check("segunda execução reaproveita a janela aberta", reused && second.code() === 0 && second.text().includes(`:${port}`));
  await first.stop();

  console.log("\n--- Importação de dados ---");
  // Banco de origem com registros deixados no WAL, sem consolidar: é o estado
  // real de um sistema em uso, e uma cópia simples do arquivo perderia tudo isso.
  const sourceFile = join(importDir, "app.sqlite");
  const source = new DatabaseSync(sourceFile);
  source.exec("PRAGMA journal_mode=WAL; CREATE TABLE records(id INTEGER PRIMARY KEY, user_id INTEGER, kind TEXT, body TEXT)");
  for (let i = 0; i < 25; i++) source.prepare("INSERT INTO records(user_id,kind,body) VALUES(1,'documents',?)").run(`{"n":${i}}`);
  source.close();
  check("origem tem dados no WAL", existsSync(`${sourceFile}-wal`) ? true : records(sourceFile) === 25, `${records(sourceFile)} registros`);
  const target2 = mkdtempSync(join(tmpdir(), "aof-dest-"));
  const imported = cli(["--importar", importDir], { DATA_DIR: target2 });
  check("--importar traz todos os registros", imported.status === 0 && records(join(target2, "app.sqlite")) === 25, `${records(join(target2, "app.sqlite"))} de 25`);
  const again = cli(["--importar", importDir], { DATA_DIR: target2 });
  const bak = again.out.match(/guardado em (.+)/)?.[1]?.trim();
  check("reimportar guarda o anterior como backup", again.status === 0 && bak && existsSync(bak) && records(bak) === 25, bak);
  check("origem inexistente é recusada", cli(["--importar", join(tmpdir(), "nao-existe-aof")], { DATA_DIR: target2 }).status === 1);
  check("--importar sem caminho orienta", /Informe a pasta/.test(cli(["--importar"], { DATA_DIR: target2 }).out));
  rmSync(target2, { recursive: true, force: true });

  console.log("\n--- Instalação por usuário ---");
  // A instalação de teste usa uma pasta temporária, mas os atalhos vão para a
  // área de trabalho e o menu Iniciar de verdade, e a desinstalação os apaga.
  // Com o sistema já instalado nesta máquina, isso destruiria os atalhos do
  // usuário: nesse caso a seção é pulada em vez de executada.
  if (installedHere.length) {
    console.log(`PULADO: já existe atalho do ${APP_NAME} nesta máquina.`);
    for (const link of installedHere) console.log(`  ${link}`);
    console.log(`Para verificar esta parte, desinstale antes: "${APP_NAME}.exe" --desinstalar`);
  } else {
    const installed = join(fakeHome, "Programs", APP_NAME, `${APP_NAME}.exe`);
    touchedLinks = true;
    const install = cli(["--instalar"], { LOCALAPPDATA: fakeHome });
    check("--instalar conclui", install.status === 0, install.out.trim().split("\n")[0]);
    check("programa copiado para a pasta do usuário", existsSync(installed) && statSync(installed).size === statSync(EXE).size);
    for (const link of links) check(`atalho em ${link.includes("Desktop") ? "área de trabalho" : "menu Iniciar"}`, existsSync(link));
    const shortcut = (property) =>
      ps(`(New-Object -ComObject WScript.Shell).CreateShortcut($env:AOF_LINK).${property}`, { AOF_LINK: links[0] });
    const target = shortcut("TargetPath");
    check(
      "atalho aponta para a cópia instalada",
      existsSync(target) && realpathSync.native(target).toLowerCase() === realpathSync.native(installed).toLowerCase(),
      target,
    );
    check("atalho abre minimizado", shortcut("WindowStyle") === "7");
    check("cópia instalada executa", spawnSync(installed, ["--versao"], { encoding: "utf8", windowsHide: true }).status === 0);

    console.log("\n--- Desinstalação ---");
    const remove = cli(["--desinstalar"], { LOCALAPPDATA: fakeHome });
    check("--desinstalar conclui", remove.status === 0, remove.out.trim().split("\n")[0]);
    check("atalhos removidos", links.every((l) => !existsSync(l)));
    check("pasta do programa removida", !existsSync(join(fakeHome, "Programs", APP_NAME)));
    check("avisa que os dados continuam", remove.out.includes("Seus dados continuam"));
  }
} catch (error) {
  check("verificação sem erro", false, error.message);
} finally {
  await app?.stop();
  // Rede de segurança: apaga só os atalhos que esta verificação criou.
  if (touchedLinks) for (const link of links) rmSync(link, { force: true });
  for (const dir of [dataDir, fakeHome, importDir]) rmSync(dir, { recursive: true, force: true });
  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n${results.length - failed}/${results.length} verificações passaram`);
  if (failed) process.exitCode = 1;
}
