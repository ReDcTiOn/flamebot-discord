import { createWriteStream } from "node:fs";
import { stat, unlink } from "node:fs/promises";
import { basename } from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";

export const MAX_MAP_BYTES = 600 * 1024 * 1024;

// Оригинальное имя .map как есть; null, если имени нет или оно не похоже на файл карты.
export function sanitizeFilename(name: string | null | undefined): string | null {
  if (!name) return null;
  const clean = basename(name.replaceAll("\\", "/"))
    .trim()
    .replace(/[\x00-\x1f]/g, "");
  return clean.toLowerCase().endsWith(".map") && clean.length > 4 ? clean : null;
}

// Имя файла из Content-Disposition, иначе из пути итоговой ссылки (после редиректов).
export function filenameFromResponse(res: Response): string | null {
  const cd = res.headers.get("content-disposition");
  if (cd) {
    const star = /filename\*\s*=\s*(?:UTF-8|utf-8)''([^;]+)/.exec(cd);
    const plain = /filename\s*=\s*"?([^";]+)"?/.exec(cd);
    const raw = star ? safeDecode(star[1]!) : plain?.[1];
    const name = sanitizeFilename(raw);
    if (name) return name;
  }
  try {
    return sanitizeFilename(safeDecode(new URL(res.url).pathname));
  } catch {
    return null;
  }
}

function safeDecode(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

// Пишет тело ответа в файл, считая байты. Больше maxBytes — ошибка, недописанный файл удаляется.
export async function saveBody(res: Response, dest: string, maxBytes = MAX_MAP_BYTES): Promise<number> {
  if (!res.body) throw new Error("Пустой ответ");
  let total = 0;
  const counter = new Transform({
    transform(chunk: Buffer, _enc, done) {
      total += chunk.length;
      if (total > maxBytes) done(new Error("Файл больше 600 МБ, это не похоже на карту"));
      else done(null, chunk);
    },
  });
  try {
    await pipeline(Readable.fromWeb(res.body as import("node:stream/web").ReadableStream), counter, createWriteStream(dest));
  } catch (err) {
    await unlink(dest).catch(() => undefined);
    throw err;
  }
  return total;
}

// Скачивает файл по прямой ссылке (без ключей API). Возвращает размер и оригинальное имя.
export async function downloadUrl(url: string, dest: string): Promise<{ size: number; filename: string | null }> {
  if (!/^https?:\/\//i.test(url)) throw new Error("Нужна ссылка http(s)");
  const res = await fetch(url, {
    redirect: "follow",
    headers: { "User-Agent": "Mozilla/5.0 (rust-map-bot)" },
    signal: AbortSignal.timeout(15 * 60_000),
  });
  if (!res.ok) throw new Error(`Сервер ответил ${res.status}`);
  if ((res.headers.get("content-type") ?? "").toLowerCase().startsWith("text/html")) {
    await res.body?.cancel();
    throw new Error("По ссылке открывается веб-страница, а не файл карты. Нужна прямая ссылка на скачивание.");
  }
  const size = await saveBody(res, dest);
  return { size, filename: filenameFromResponse(res) };
}

export async function fileSize(path: string): Promise<number> {
  return (await stat(path)).size;
}
