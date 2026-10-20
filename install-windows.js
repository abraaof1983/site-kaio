import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, rmSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { DatabaseSync, backup } from "node:sqlite";
import { APP_NAME, dataDir, ensureDir, installDir, packaged } from "./app-env.js";

// Instalação por usuário, sem administrador: o programa é copiado para
// %LOCALAPPDATA%\Programs e os atalhos vão para o menu Iniciar e a área de
// trabalho do usuário. Nada é escrito em Program Files nem no registro.
const LINK = `${APP_NAME}.lnk`;
const EXE = `${APP_NAME}.exe`;

function powershell(script, env = {}) {
  const r = spawnSync(
    "powershell",
    ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", script],
    { env: { ...process.env, ...env }, encoding: "utf8", windowsHide: true },
  );
  if (r.error || r.status !== 0) throw Error(`Falha ao falar com o Windows: ${(r.stderr || r.error?.message || "").trim()}`);
  return r.stdout.trim();
}

// Pastas do shell, porque Área de Trabalho e Menu Iniciar podem estar
// redirecionadas (OneDrive, perfil de rede).
function shellFolder(name, fallback) {
  try {
    const path = powershell(`[Environment]::GetFolderPath('${name}')`);
    if (path && existsSync(path)) return path;
  } catch {}
  return fallback;
}
const desktopDir = () => shellFolder("Desktop", join(process.env.USERPROFILE || ".", "Desktop"));
const startMenuDir = () =>
  shellFolder("Programs", join(process.env.APPDATA || ".", "Microsoft", "Windows", "Start Menu", "Programs"));

function createShortcut(link, target) {
  // Os valores vão por variável de ambiente para não precisarem de escape.
  powershell(
    [
      "$s = (New-Object -ComObject WScript.Shell).CreateShortcut($env:AOF_LINK)",
      "$s.TargetPath = $env:AOF_TARGET",
      "$s.WorkingDirectory = Split-Path -Parent $env:AOF_TARGET",
      "$s.Description = $env:AOF_DESC",
      "$s.IconLocation = $env:AOF_TARGET",
      // Inicia minimizado: a janela preta é só o motor do sistema; o uso é no navegador.
      "$s.WindowStyle = 7",
      "$s.Save()",
    ].join("; "),
    { AOF_LINK: link, AOF_TARGET: target, AOF_DESC: `${APP_NAME} · orçamentos e contratos` },
  );
}

function requirePackaged(action) {
  if (!packaged)
    throw Error(
      `${action} só funciona no executável compilado. Pelo código-fonte use "npm start".\nPara gerar o executável: npm run build:exe`,
    );
}

export function install() {
  requirePackaged("A instalação");
  const target = ensureDir(installDir());
  const exe = join(target, EXE);
  const source = process.execPath;
  if (resolve(source).toLowerCase() !== resolve(exe).toLowerCase())
    try {
      copyFileSync(source, exe);
    } catch (error) {
      // Atualizar por cima de uma versão aberta: o Windows mantém o arquivo preso.
      if (["EBUSY", "EPERM", "EACCES"].includes(error.code))
        throw Error(
          `O ${APP_NAME} parece estar aberto. Feche a janela do sistema e rode a instalação novamente.\n(${exe})`,
        );
      throw error;
    }
  const links = [join(startMenuDir(), LINK), join(desktopDir(), LINK)];
  for (const link of links) createShortcut(link, exe);
  console.log(`${APP_NAME} instalado para o seu usuário do Windows.\n`);
  console.log(`  Programa: ${exe}`);
  console.log(`  Atalhos:  ${links.join("\n            ")}`);
  console.log(`  Dados:    ${dataDir()}`);
  console.log("\nAbra pelo menu Iniciar ou pelo atalho da área de trabalho.");
  console.log("Para trazer dados de uma instalação anterior:");
  console.log(`  "${exe}" --importar <pasta com app.sqlite>`);
}

export function uninstall() {
  requirePackaged("A desinstalação");
  const target = installDir();
  const removed = [];
  for (const link of [join(startMenuDir(), LINK), join(desktopDir(), LINK)])
    if (existsSync(link)) {
      rmSync(link, { force: true });
      removed.push(link);
    }
  // O executável em uso fica travado pelo Windows: não dá para apagar a própria pasta.
  const running = resolve(process.execPath).toLowerCase().startsWith(resolve(target).toLowerCase());
  let folder = null;
  if (!running && existsSync(target)) {
    rmSync(target, { recursive: true, force: true });
    folder = target;
  }
  console.log(`${APP_NAME} removido do seu usuário.\n`);
  if (removed.length) console.log(`  Atalhos apagados: ${removed.join("\n                    ")}`);
  if (folder) console.log(`  Pasta apagada:    ${folder}`);
  if (running) console.log(`  A pasta ${target} está em uso por este programa. Apague-a depois de fechar esta janela.`);
  console.log(`\nSeus dados continuam em ${dataDir()}. Apague essa pasta à mão se quiser remover tudo.`);
}

/** Cópia consistente de um banco SQLite, com o conteúdo do WAL já aplicado. */
async function copyDatabase(from, to) {
  const db = new DatabaseSync(from, { readOnly: true });
  try {
    await backup(db, to);
  } finally {
    db.close();
  }
}

/** Copia um banco existente para a pasta de dados, guardando o atual como backup. */
export async function importData(from) {
  if (!from) throw Error('Informe a pasta ou o arquivo de origem. Exemplo: --importar "C:\\site-kaio\\data"');
  const origin = resolve(from);
  if (!existsSync(origin)) throw Error(`Não encontrei ${origin}`);
  const source = statSync(origin).isDirectory() ? join(origin, "app.sqlite") : origin;
  if (!existsSync(source)) throw Error(`Não encontrei um app.sqlite em ${origin}`);
  const target = join(ensureDir(dataDir()), "app.sqlite");
  if (resolve(source).toLowerCase() === resolve(target).toLowerCase())
    throw Error("A origem e o destino são o mesmo arquivo.");
  // backup() do SQLite copia o banco já consolidado, incluindo o que estiver no
  // WAL, sem alterar a origem. Copiar o arquivo solto perderia dados recentes.
  if (existsSync(target)) {
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const saved = `${target}.${stamp}.bak`;
    await copyDatabase(target, saved);
    console.log(`Banco atual guardado em ${saved}`);
  }
  // Os arquivos -wal e -shm pertencem ao banco anterior e precisam sair antes da
  // cópia: o SQLite tentaria recuperar esse WAL ao abrir o arquivo de destino.
  for (const extra of ["", "-wal", "-shm"]) rmSync(`${target}${extra}`, { force: true });
  await copyDatabase(source, target);
  const count = (() => {
    const copy = new DatabaseSync(target, { readOnly: true });
    try {
      return copy.prepare("SELECT COUNT(*) AS n FROM records").get().n;
    } finally {
      copy.close();
    }
  })();
  if (!count) console.log("Atenção: o banco importado não tem registros.");
  console.log(`Importado de ${source}`);
  console.log(`Para ${target} · ${count} registros (clientes, pacotes e documentos).`);
  console.log("O arquivo de origem não foi alterado.");
}
