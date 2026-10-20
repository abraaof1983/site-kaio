import {
  APP_NAME,
  APP_VERSION,
  dataDir,
  installDir,
  packaged,
} from "./app-env.js";
import { importData, install, uninstall } from "./install-windows.js";
import { desktopRequested, reportDesktopError } from "./desktop-window.js";

// Porta de entrada do programa. Sem argumentos, sobe o sistema e abre o
// navegador; os demais comandos cuidam da instalação por usuário e dos dados.
const COMMANDS = {
  "--instalar": "Instala para o seu usuário do Windows e cria os atalhos.",
  "--desinstalar":
    "Remove os atalhos e a pasta do programa. Os dados são preservados.",
  "--importar <caminho>":
    "Copia um banco app.sqlite existente para a pasta de dados.",
  "--pasta-dados": "Mostra onde ficam o banco e os backups.",
  "--versao": "Mostra a versão instalada.",
  "--ajuda": "Mostra esta lista.",
};

function help() {
  const exe = packaged ? `"${APP_NAME}.exe"` : "node main.js";
  console.log(`${APP_NAME} ${APP_VERSION}`);
  console.log("\nSistema de orçamentos e contratos. Roda no seu computador: o");
  console.log("banco é local e o servidor responde apenas em 127.0.0.1.\n");
  console.log(`Uso: ${exe} [comando]\n`);
  console.log(`Sem comando, abre o sistema no navegador.\n`);
  for (const [name, text] of Object.entries(COMMANDS))
    console.log(`  ${name.padEnd(22)} ${text}`);
  console.log(`\nPasta de dados atual: ${dataDir()}`);
  if (packaged) console.log(`Pasta de instalação:  ${installDir()}`);
}

async function main() {
  const [command, ...rest] = process.argv.slice(2);
  switch (command) {
    case undefined:
      // Importar aqui, e não no topo, para os comandos acima não abrirem o banco.
      await import("./server.js");
      return;
    case "--instalar":
      return install();
    case "--desinstalar":
      return uninstall();
    case "--importar":
      return importData(rest[0]);
    case "--pasta-dados":
      console.log(dataDir());
      return;
    case "--versao":
    case "-v":
      console.log(`${APP_NAME} ${APP_VERSION}`);
      return;
    case "--ajuda":
    case "-h":
    case "--help":
      return help();
    default:
      console.error(`Comando desconhecido: ${command}\n`);
      help();
      process.exitCode = 1;
  }
}

main().catch((error) => {
  if (desktopRequested() || packaged) reportDesktopError(error);
  else console.error(error.message);
  process.exitCode = 1;
});
