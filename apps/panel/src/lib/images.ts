import { createCanvas, loadImage } from "@napi-rs/canvas";
import { ActionError } from "./auth";

export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;
const MAX_SIDE = 6000;
const MAX_PIXELS = 36_000_000;
// Больше карточки картинка быть не может, поэтому всё крупнее уменьшаем.
const TARGET_MAX_W = 1600;
const TARGET_MAX_H = 1000;

type Kind = "png" | "jpeg" | "webp";

// Размеры читаем из заголовка файла до декодирования, чтобы маленький файл
// с огромными размерами (decompression bomb) не съел всю память сервера.
function sniff(buf: Buffer): { kind: Kind; width: number; height: number } | null {
  if (buf.length >= 24 && buf.readUInt32BE(0) === 0x89504e47 && buf.toString("ascii", 12, 16) === "IHDR") {
    return { kind: "png", width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
  }
  if (buf.length >= 4 && buf[0] === 0xff && buf[1] === 0xd8) {
    let i = 2;
    while (i + 9 < buf.length) {
      if (buf[i] !== 0xff) return null;
      const marker = buf[i + 1]!;
      const size = buf.readUInt16BE(i + 2);
      // SOF0..SOF15, кроме DHT/JPG/DAC
      if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
        return { kind: "jpeg", height: buf.readUInt16BE(i + 5), width: buf.readUInt16BE(i + 7) };
      }
      i += 2 + size;
    }
    return null;
  }
  if (buf.length >= 30 && buf.toString("ascii", 0, 4) === "RIFF" && buf.toString("ascii", 8, 12) === "WEBP") {
    const chunk = buf.toString("ascii", 12, 16);
    if (chunk === "VP8X") return { kind: "webp", width: 1 + buf.readUIntLE(24, 3), height: 1 + buf.readUIntLE(27, 3) };
    if (chunk === "VP8L") {
      const b = buf.readUInt32LE(21);
      return { kind: "webp", width: 1 + (b & 0x3fff), height: 1 + ((b >> 14) & 0x3fff) };
    }
    if (chunk === "VP8 ") return { kind: "webp", width: buf.readUInt16LE(26) & 0x3fff, height: buf.readUInt16LE(28) & 0x3fff };
  }
  return null;
}

// Проверяет и перекодирует загруженную картинку. Наружу уходит только то,
// что заново нарисовано на чистом холсте: никаких метаданных и «полиглот»-файлов.
export async function sanitizeImage(file: File): Promise<{ data: Buffer; mime: string; width: number; height: number }> {
  if (file.size === 0) throw new ActionError("Файл пустой");
  if (file.size > MAX_UPLOAD_BYTES) throw new ActionError("Картинка больше 5 МБ");

  const buf = Buffer.from(await file.arrayBuffer());
  const info = sniff(buf);
  if (!info) throw new ActionError("Поддерживаются только PNG, JPEG и WebP");
  if (!info.width || !info.height || info.width > MAX_SIDE || info.height > MAX_SIDE || info.width * info.height > MAX_PIXELS) {
    throw new ActionError(`Картинка слишком большая: максимум ${MAX_SIDE}×${MAX_SIDE} пикселей`);
  }

  let img;
  try {
    img = await loadImage(buf);
  } catch {
    throw new ActionError("Не удалось прочитать картинку");
  }

  const scale = Math.min(1, TARGET_MAX_W / img.width, TARGET_MAX_H / img.height);
  const width = Math.max(1, Math.round(img.width * scale));
  const height = Math.max(1, Math.round(img.height * scale));
  const canvas = createCanvas(width, height);
  canvas.getContext("2d").drawImage(img, 0, 0, width, height);

  // JPEG без прозрачности весит меньше; PNG и WebP могут быть прозрачными.
  if (info.kind === "jpeg") return { data: canvas.toBuffer("image/jpeg", 90), mime: "image/jpeg", width, height };
  return { data: canvas.toBuffer("image/png"), mime: "image/png", width, height };
}
