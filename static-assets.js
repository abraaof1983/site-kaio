import { createHash } from "node:crypto";
import { extname, posix } from "node:path";
import { assetList, packaged, readAsset } from "./app-env.js";

// Serve as telas e imagens da pasta public. Substitui express.static porque, no
// executável único, esses arquivos não existem em disco: ficam embutidos no .exe.
const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".ttf": "font/ttf",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".txt": "text/plain; charset=utf-8",
};
const tags = new Map();

function etag(name, body) {
  // No executável o conteúdo não muda; em desenvolvimento recalcula a cada pedido.
  if (packaged && tags.has(name)) return tags.get(name);
  const tag = `"${createHash("sha1").update(body).digest("base64url")}"`;
  if (packaged) tags.set(name, tag);
  return tag;
}

export function serveAssets(prefix = "public") {
  // Dentro do executável a lista é fixa; em desenvolvimento consulta o disco,
  // para arquivos novos aparecerem sem recompilar.
  const known = packaged ? new Set(assetList(prefix)) : null;
  const available = (name) => (known ?? new Set(assetList(prefix))).has(name);
  return function assets(req, res, next) {
    if (req.method !== "GET" && req.method !== "HEAD") return next();
    let path;
    try {
      path = decodeURIComponent(req.path).replace(/\\/g, "/");
    } catch {
      return next();
    }
    if (path.includes("\0") || path.split("/").some((part) => part === ".."))
      return next();
    if (path.endsWith("/")) path += "index.html";
    // normalize resolve ".." antes da checagem, então não há como sair da pasta.
    const name = posix.normalize(`${prefix}${path}`);
    if (!name.startsWith(`${prefix}/`) || !available(name)) return next();
    const body = readAsset(name);
    const tag = etag(name, body);
    res.setHeader(
      "Content-Type",
      TYPES[extname(name).toLowerCase()] || "application/octet-stream",
    );
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("ETag", tag);
    if (req.headers["if-none-match"] === tag) return res.status(304).end();
    res.setHeader("Content-Length", body.length);
    return req.method === "HEAD" ? res.end() : res.end(body);
  };
}
