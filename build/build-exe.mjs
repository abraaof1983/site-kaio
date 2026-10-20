import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { inject } from "postject";
import rcedit from "rcedit";

// Gera um executável único do Windows (Node SEA): o runtime do Node, o código do
// sistema e os recursos (fontes, telas, imagens) ficam dentro do próprio .exe.
// Assim a instalação é copiar um arquivo, sem administrador e sem instalar Node.
const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const work = join(root, "build", ".work");
const dist = join(root, "dist");
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const APP_NAME = "AOF Studio";
const bundle = join(work, "app.cjs");
const blob = join(work, "sea.blob");
const stage = join(dist, APP_NAME);
const exe = join(stage, `${APP_NAME}.exe`);
// Marca que o Node procura no próprio binário para saber que virou um executável
// de aplicação. O valor é fixo no Node e precisa existir no node.exe de origem.
const FUSE = "NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2";
const step = (text) => console.log(`\n== ${text}`);

function run(label, file, args) {
  const r = spawnSync(file, args, { cwd: root, encoding: "utf8", windowsHide: true });
  if (r.error) throw Error(`${label}: ${r.error.message}`);
  if (r.status !== 0) throw Error(`${label} falhou (${r.status}):\n${r.stdout || ""}${r.stderr || ""}`);
  return r.stdout || "";
}

function filesUnder(dir) {
  const found = [];
  const walk = (current) => {
    for (const entry of readdirSync(join(root, current), { withFileTypes: true })) {
      const next = `${current}/${entry.name}`;
      if (entry.isDirectory()) walk(next);
      else found.push(next);
    }
  };
  walk(dir);
  return found;
}

const kb = (bytes) => `${(bytes / 1024).toFixed(0)} KB`;
const mb = (bytes) => `${(bytes / 1024 / 1024).toFixed(1)} MB`;

step("Limpando a saída anterior");
// O Windows costuma manter o executável preso por alguns instantes depois do uso
// (antivírus, Explorer); por isso as tentativas repetidas.
const clean = (path) => rmSync(path, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 });
clean(work);
clean(dist);
mkdirSync(work, { recursive: true });
mkdirSync(stage, { recursive: true });

step("Juntando o código num único arquivo");
// O executável do Node precisa de um ponto de entrada CommonJS, e o projeto é em
// módulos ES: o esbuild converte e embute as dependências (express, pdfkit).
const result = await build({
  entryPoints: [join(root, "main.js")],
  outfile: bundle,
  platform: "node",
  target: "node24",
  format: "cjs",
  bundle: true,
  define: {
    // A versão do package.json entra no código; dentro do .exe não há package.json.
    "process.env.AOF_VERSION": JSON.stringify(pkg.version),
    // Dentro do executável não existe pasta de origem. app-env.js não usa este
    // valor quando empacotado; definir aqui evita o aviso do formato CommonJS.
    "import.meta.url": JSON.stringify("file:///aof-studio/"),
  },
  legalComments: "none",
  logLevel: "warning",
  metafile: true,
});
console.log(`${relative(root, bundle)}: ${kb(statSync(bundle).size)}`);
const bundled = Object.keys(result.metafile.inputs).filter((f) => f.includes("node_modules")).length;
console.log(`módulos embutidos de node_modules: ${bundled}`);

step("Reunindo os recursos");
// Nomes iguais aos usados em app-env.js, para o mesmo código achar o recurso
// em disco (npm start) e dentro do executável.
const assets = {};
for (const name of [
  "assets/fonts/DejaVuSans.ttf",
  "assets/fonts/DejaVuSans-Bold.ttf",
  "assets/fonts/LICENSE",
  ...filesUnder("public"),
])
  assets[name] = join(root, name);
const assetBytes = Object.values(assets).reduce((sum, path) => sum + statSync(path).size, 0);
console.log(`${Object.keys(assets).length} recursos · ${mb(assetBytes)}`);

step("Preparando o pacote do executável");
const seaConfig = join(work, "sea-config.json");
writeFileSync(
  seaConfig,
  JSON.stringify(
    {
      main: bundle,
      output: blob,
      disableExperimentalSEAWarning: true,
      useSnapshot: false,
      useCodeCache: true,
      assets,
    },
    null,
    2,
  ),
);
console.log(run("Empacotamento", process.execPath, ["--experimental-sea-config", seaConfig]).trim());
console.log(`${relative(root, blob)}: ${mb(statSync(blob).size)}`);

// O node.exe vem assinado pela Node.js Foundation. Como o executável é alterado
// para receber o pacote, a assinatura deixa de valer: removê-la é mais limpo que
// deixar uma assinatura quebrada, que antivírus tratam como arquivo adulterado.
function stripSignature(path) {
  const file = readFileSync(path);
  const pe = file.readUInt32LE(0x3c);
  if (file.toString("latin1", pe, pe + 4) !== "PE\0\0") throw Error("Formato de executável inesperado.");
  const optional = pe + 24;
  const plus = file.readUInt16LE(optional) === 0x20b; // PE32+ (64 bits)
  const security = optional + (plus ? 112 : 96) + 4 * 8; // 5ª entrada: tabela de certificados
  const at = file.readUInt32LE(security);
  const size = file.readUInt32LE(security + 4);
  if (!size) return 0;
  file.writeUInt32LE(0, security);
  file.writeUInt32LE(0, security + 4);
  file.writeUInt32LE(0, optional + 64); // CheckSum, que o Windows ignora em programas
  // Os certificados ficam no fim do arquivo; o resto do conteúdo não se move.
  writeFileSync(path, at + size >= file.length ? file.subarray(0, at) : file);
  return size;
}

step("Criando o executável");
copyFileSync(process.execPath, exe);
const stripped = stripSignature(exe);
console.log(`assinatura original removida: ${stripped ? kb(stripped) : "nenhuma"}`);

// Ícone e propriedades antes de injetar o pacote: o rcedit reescreve a tabela de
// recursos, e fazê-lo depois poderia deslocar o recurso com o código do sistema.
const icon = join(root, "assets", "aof-studio.ico");
await rcedit(exe, {
  icon: existsSync(icon) ? icon : undefined,
  "file-version": `${pkg.version}.0`,
  "product-version": `${pkg.version}.0`,
  "version-string": {
    ProductName: APP_NAME,
    FileDescription: `${APP_NAME} · orçamentos e contratos`,
    CompanyName: "AOF Serviços",
    LegalCopyright: `© ${new Date().getFullYear()} AOF Serviços`,
    InternalName: APP_NAME,
    OriginalFilename: `${APP_NAME}.exe`,
  },
});
if (!existsSync(icon)) console.log("sem ícone próprio: gere com node build/make-icon.mjs");

if (!readFileSync(exe).includes(FUSE))
  throw Error(`O node.exe usado não tem a marca ${FUSE}. Use o Node 24 oficial para Windows.`);
await inject(exe, "NODE_SEA_BLOB", readFileSync(blob), { sentinelFuse: FUSE });
console.log(`${relative(root, exe)}: ${mb(statSync(exe).size)}`);

step("Conferindo o executável");
// Responder a --versao prova que o pacote sobreviveu às alterações no binário.
const version = run("Executável", exe, ["--versao"]).trim();
if (!version.includes(pkg.version)) throw Error(`O executável respondeu "${version}", esperava a versão ${pkg.version}.`);
console.log(version);
const info = run("Propriedades", "powershell", [
  "-NoProfile",
  "-NonInteractive",
  "-Command",
  `$i = (Get-Item -LiteralPath '${exe}').VersionInfo; "$($i.ProductName) | $($i.FileDescription) | $($i.ProductVersion)"`,
]).trim();
if (!info.startsWith(APP_NAME)) throw Error(`As propriedades do executável não foram aplicadas: ${info}`);
console.log(`propriedades: ${info}`);

step("Escrevendo os arquivos de distribuição");
// Sem acentos: arquivos .cmd rodam na página de código do console, onde acento
// de UTF-8 sai trocado.
writeFileSync(
  join(stage, "Instalar.cmd"),
  [
    "@echo off",
    "setlocal",
    "cd /d \"%~dp0\"",
    "echo Instalando o AOF Studio para o seu usuario do Windows.",
    "echo Nao e necessario ser administrador do computador.",
    "echo.",
    `"%~dp0${APP_NAME}.exe" --instalar`,
    "if errorlevel 1 goto erro",
    "echo.",
    "echo Pronto. Abra o AOF Studio pelo menu Iniciar ou pelo atalho da area de trabalho.",
    "pause",
    "exit /b 0",
    ":erro",
    "echo.",
    "echo A instalacao nao foi concluida. Copie a mensagem acima para diagnostico.",
    "pause",
    "exit /b 1",
    "",
  ].join("\r\n"),
  "ascii",
);
const readme = [
  `${APP_NAME} ${pkg.version}`,
  "",
  "Sistema de orçamentos e contratos que roda no seu próprio computador.",
  "",
  "COMO INSTALAR",
  "",
  "  1. Clique duas vezes em Instalar.cmd.",
  "  2. Abra o AOF Studio pelo menu Iniciar ou pelo atalho da área de trabalho.",
  "",
  "Não é preciso ser administrador e não é preciso instalar o Node.js: o",
  "programa é um único arquivo, com tudo dentro. A instalação copia esse",
  "arquivo para a sua pasta de usuário e cria os atalhos.",
  "",
  "ONDE FICAM OS DADOS",
  "",
  "  %LOCALAPPDATA%\\AOF Studio\\data",
  "",
  "Clientes, orçamentos e contratos ficam nesse banco, no seu computador.",
  "Nada é enviado para a internet. Para ver o caminho exato:",
  "",
  `  "${APP_NAME}.exe" --pasta-dados`,
  "",
  "Faça backup copiando a pasta inteira com o programa fechado.",
  "",
  "TRAZER DADOS DE UMA INSTALAÇÃO ANTERIOR",
  "",
  `  "${APP_NAME}.exe" --importar "C:\\caminho\\da\\pasta\\data"`,
  "",
  "O banco atual é guardado como .bak antes da troca.",
  "",
  "COMO USAR",
  "",
  "Ao abrir, o sistema sobe no seu computador e o navegador abre em",
  "http://localhost:3000. A janela preta é o motor do sistema: deixe-a",
  "aberta durante o uso e feche-a para encerrar.",
  "",
  "O endereço responde somente neste computador (127.0.0.1): outras",
  "máquinas da rede não alcançam o sistema nem o banco.",
  "",
  "COMO DESINSTALAR",
  "",
  `  "${APP_NAME}.exe" --desinstalar`,
  "",
  "Os atalhos e a pasta do programa são removidos. Seus dados continuam",
  "na pasta acima, para você apagar quando quiser.",
  "",
  "OUTROS COMANDOS",
  "",
  `  "${APP_NAME}.exe" --ajuda`,
  "",
].join("\r\n");
writeFileSync(join(stage, "LEIA-ME.txt"), `\ufeff${readme}`, "utf8");
console.log(readdirSync(stage).join(", "));

step("Compactando para entrega");
const zip = join(dist, `${APP_NAME.replace(/ /g, "-")}-${pkg.version}-windows.zip`);
// tar do Windows (bsdtar) grava zip e é bem mais rápido que Compress-Archive.
try {
  run("Compactação", "tar", ["-a", "-c", "-f", zip, "-C", dist, APP_NAME]);
} catch {
  run("Compactação", "powershell", [
    "-NoProfile",
    "-NonInteractive",
    "-Command",
    `Compress-Archive -Path '${stage}' -DestinationPath '${zip}' -Force`,
  ]);
}
console.log(`${relative(root, zip)}: ${mb(statSync(zip).size)}`);

console.log(`\nPronto. Para instalar neste computador: "${exe}" --instalar`);
