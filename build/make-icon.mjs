import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// Gera o ícone do programa a partir do logo. Roda só quando o logo muda: o .ico
// fica versionado, então a compilação do dia a dia não depende disto.
// Uso: node build/make-icon.mjs
const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const source = join(root, "public", "quote-assets", "logo-contrato.jpg");
const target = join(root, "assets", "aof-studio.ico");
const work = join(root, "build", ".work", "icon");
const SIZES = [16, 24, 32, 48, 64, 128, 256];

rmSync(work, { recursive: true, force: true });
mkdirSync(work, { recursive: true });

// O redimensionamento usa o GDI+ do próprio Windows, sem dependência nova.
const script = `
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
$src = [System.Drawing.Image]::FromFile($env:ICON_SRC)
foreach ($size in ($env:ICON_SIZES -split ',')) {
  $n = [int]$size
  $bmp = New-Object System.Drawing.Bitmap $n, $n
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.InterpolationMode = 'HighQualityBicubic'
  $g.SmoothingMode = 'HighQuality'
  $g.PixelOffsetMode = 'HighQuality'
  $g.Clear([System.Drawing.Color]::White)
  $g.DrawImage($src, (New-Object System.Drawing.Rectangle 0, 0, $n, $n))
  $g.Dispose()
  $bmp.Save((Join-Path $env:ICON_WORK "$n.png"), [System.Drawing.Imaging.ImageFormat]::Png)
  $bmp.Dispose()
}
$src.Dispose()
`;
const r = spawnSync("powershell", ["-NoProfile", "-NonInteractive", "-Command", script], {
  env: { ...process.env, ICON_SRC: source, ICON_WORK: work, ICON_SIZES: SIZES.join(",") },
  encoding: "utf8",
  windowsHide: true,
});
if (r.status !== 0) throw Error(`Falha ao redimensionar o logo: ${r.stderr || r.stdout}`);

// Container ICO com imagens PNG dentro, aceito pelo Windows desde o Vista.
const images = SIZES.map((size) => ({ size, data: readFileSync(join(work, `${size}.png`)) }));
const header = Buffer.alloc(6);
header.writeUInt16LE(0, 0); // reservado
header.writeUInt16LE(1, 2); // 1 = ícone
header.writeUInt16LE(images.length, 4);
let offset = 6 + images.length * 16;
const entries = images.map(({ size, data }) => {
  const entry = Buffer.alloc(16);
  entry.writeUInt8(size >= 256 ? 0 : size, 0); // 0 representa 256
  entry.writeUInt8(size >= 256 ? 0 : size, 1);
  entry.writeUInt8(0, 2); // paleta: nenhuma
  entry.writeUInt8(0, 3); // reservado
  entry.writeUInt16LE(1, 4); // planos
  entry.writeUInt16LE(32, 6); // bits por pixel
  entry.writeUInt32LE(data.length, 8);
  entry.writeUInt32LE(offset, 12);
  offset += data.length;
  return entry;
});
writeFileSync(target, Buffer.concat([header, ...entries, ...images.map((i) => i.data)]));
rmSync(work, { recursive: true, force: true });
console.log(`${target}: ${(readFileSync(target).length / 1024).toFixed(0)} KB · ${SIZES.join(", ")} px`);
