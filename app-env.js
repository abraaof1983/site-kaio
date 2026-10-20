import { existsSync, mkdirSync, readFileSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join, posix, resolve } from "node:path";
import { getAsset, getAssetKeys, isSea } from "node:sea";
import { fileURLToPath } from "node:url";

// Ambiente da aplicação. O mesmo código roda de duas formas:
//   - pelo código-fonte (npm start), lendo arquivos da pasta do projeto;
//   - dentro do executável único do Windows, onde não há arquivos em disco e as
//     fontes, imagens e telas ficam embutidas no próprio .exe (assets do Node SEA).
// Por isso nada aqui usa caminho relativo ao diretório de trabalho.
export const APP_NAME = "AOF Studio";
export const packaged = isSea();
// A pasta do projeto existe somente fora do executável; dentro dele os recursos
// vêm embutidos e este valor nunca é usado.
const root = packaged ? null : fileURLToPath(new URL(".", import.meta.url));
// A versão é injetada na compilação; fora dela vem do package.json.
export const APP_VERSION =
  process.env.AOF_VERSION ||
  (root ? JSON.parse(readFileSync(join(root, "package.json"), "utf8")).version : "0.0.0");

let keys = null;
const contents = new Map();
const assetKeys = () => (keys ??= new Set(getAssetKeys()));

// Recursos são sempre nomeados como "pasta/arquivo", relativo à raiz do projeto,
// tanto em disco quanto dentro do executável. Nomes que escapam da raiz são recusados.
function assetName(key) {
  const name = posix.normalize(String(key ?? "").replace(/\\/g, "/"));
  return name.startsWith("../") || name.startsWith("/") || name === "." ? null : name;
}

export function assetExists(key) {
  const name = assetName(key);
  if (!name) return false;
  return packaged ? assetKeys().has(name) : existsSync(join(root, name));
}

/** Conteúdo de um recurso embutido, como Buffer. Lança erro quando não existe. */
export function readAsset(key) {
  const name = assetName(key);
  if (!name) throw Error(`Recurso inválido: ${key}`);
  // Em desenvolvimento lê sempre do disco, para editar sem reiniciar o servidor.
  if (!packaged) return readFileSync(join(root, name));
  const cached = contents.get(name);
  if (cached) return cached;
  const data = Buffer.from(getAsset(name));
  contents.set(name, data);
  return data;
}

/** Igual a readAsset, mas devolve null quando o recurso é opcional e não existe. */
export function tryAsset(key) {
  try {
    return assetExists(key) ? readAsset(key) : null;
  } catch {
    return null;
  }
}

/** Lista os recursos de uma pasta, por exemplo "public". */
export function assetList(prefix) {
  const base = assetName(prefix);
  if (!base) return [];
  if (packaged) return [...assetKeys()].filter((name) => name.startsWith(`${base}/`));
  const found = [];
  const walk = (dir) => {
    for (const entry of readdirSync(join(root, dir), { withFileTypes: true })) {
      if (entry.isDirectory()) walk(`${dir}/${entry.name}`);
      else found.push(`${dir}/${entry.name}`);
    }
  };
  if (existsSync(join(root, base))) walk(base);
  return found;
}

const localAppData = () => process.env.LOCALAPPDATA || join(homedir(), "AppData", "Local");

/**
 * Pasta dos dados do usuário. No executável fica no perfil do Windows, fora de
 * Program Files, para instalar e gravar sem ser administrador. DATA_DIR tem
 * prioridade e é usado pelos testes e pela execução em servidor.
 */
export function dataDir() {
  if (process.env.DATA_DIR) return resolve(process.env.DATA_DIR);
  return packaged ? join(localAppData(), APP_NAME, "data") : resolve(root, "data");
}

/** Pasta de instalação por usuário, sem passar por Program Files. */
export function installDir() {
  return join(localAppData(), "Programs", APP_NAME);
}

export function ensureDir(path) {
  mkdirSync(path, { recursive: true });
  return path;
}
