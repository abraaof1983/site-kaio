// Logos are stored with each account's settings and copied into document snapshots.
// Only small, decoded PNG/JPEG files are accepted; SVG/HTML/remote URLs are never used.
import PDFDocument from "pdfkit";
export const LOGO_FIELDS = ["quoteLogoDataUrl", "contractLogoDataUrl"];
export const MAX_LOGO_BYTES = 256 * 1024;
const DATA_URL = /^data:image\/(png|jpeg);base64,([A-Za-z0-9+/]+={0,2})$/;
export function logoBuffer(value) {
  if (typeof value !== "string") return null;
  const match = DATA_URL.exec(value);
  if (!match || match[2].length > Math.ceil(MAX_LOGO_BYTES / 3) * 4)
    return null;
  const data = Buffer.from(match[2], "base64");
  if (
    !data.length ||
    data.length > MAX_LOGO_BYTES ||
    data.toString("base64") !== match[2]
  )
    return null;
  const png =
    data.length > 24 &&
    data.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  const jpeg =
    data.length > 3 && data[0] === 255 && data[1] === 216 && data[2] === 255;
  if ((match[1] === "png" && !png) || (match[1] === "jpeg" && !jpeg))
    return null;
  return data;
}
export function validateLogos(settings) {
  for (const field of LOGO_FIELDS) {
    const value = settings[field];
    if (value == null || value === "") continue;
    const data = logoBuffer(value);
    if (!data) return "Escolha um logotipo PNG ou JPG com até 256 KB.";
    try {
      // PDFKit parses the actual raster metadata. Small file limits alone do not
      // prevent enormous dimensions and excessive memory consumption on printing.
      const inspector = new PDFDocument({ autoFirstPage: false, font: null });
      let image;
      try {
        image = inspector.openImage(data);
      } finally {
        inspector.destroy();
      }
      if (
        !image.width ||
        !image.height ||
        image.width > 2048 ||
        image.height > 2048
      )
        return "O logotipo deve ter no máximo 2048 × 2048 pixels.";
    } catch {
      return "Não foi possível ler o logotipo. Escolha um arquivo PNG ou JPG válido.";
    }
  }
  return null;
}
