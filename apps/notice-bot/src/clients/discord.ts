import { sleep } from "../events.js";

// Объявление в Discord через вебхук: тело сообщения из текста и картинка поста вложением.

export class SendError extends Error {}

export interface Image {
  data: Buffer;
  mime: string;
}

// ASCII-имя, чтобы attachment:// всегда работал.
export const uploadName = (img: Image) => `wipe.${img.mime === "image/jpeg" ? "jpg" : img.mime === "image/webp" ? "webp" : "png"}`;

// Тело, каким оно уйдёт: в первый embed всегда ставим картинку поста, даже если в тексте осталась внешняя ссылка.
export function discordPayload(payload: Record<string, unknown>, img: Image): Record<string, unknown> {
  const body = structuredClone(payload);
  const embeds = body.embeds;
  if (Array.isArray(embeds) && embeds[0] && typeof embeds[0] === "object") {
    (embeds[0] as Record<string, unknown>).image = { url: `attachment://${uploadName(img)}` };
  }
  return body;
}

export async function sendDiscord(url: string, payload: Record<string, unknown>, img: Image): Promise<string> {
  const body = JSON.stringify(discordPayload(payload, img));
  // Повторяем только то, что точно не создало сообщение: 429 и «не смогли соединиться».
  // Таймаут и 5xx не повторяем: иначе можно продублировать пост.
  for (let attempt = 1; attempt <= 3; attempt++) {
    const form = new FormData();
    form.set("payload_json", new Blob([body], { type: "application/json" }));
    form.set("files[0]", new Blob([new Uint8Array(img.data)], { type: img.mime }), uploadName(img));
    let res: Response;
    try {
      res = await fetch(`${url}?wait=true`, { method: "POST", body: form, signal: AbortSignal.timeout(60_000) });
    } catch (err) {
      const timeout = err instanceof Error && err.name === "TimeoutError";
      if (timeout) throw new SendError("Discord не ответил за минуту. Сообщение могло уйти: проверь канал, прежде чем повторять");
      if (attempt === 3) throw new SendError("Discord: нет соединения");
      await sleep(2000 * attempt);
      continue;
    }
    if (res.status === 429 && attempt < 3) {
      const info = (await res.json().catch(() => ({}))) as { retry_after?: number };
      await sleep(Math.min(Number(info.retry_after ?? 1), 30) * 1000);
      continue;
    }
    if (res.status >= 300) throw new SendError(`Discord ${res.status}: ${(await res.text()).slice(0, 300)}`);
    const info = (await res.json().catch(() => ({}))) as { id?: string };
    return `сообщение ${info.id ?? "?"}`;
  }
  throw new SendError("Discord: исчерпаны попытки");
}

// Проверка вебхука без отправки сообщения: GET отдаёт его имя.
export async function checkWebhook(url: string): Promise<string> {
  const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
  if (res.status === 404 || res.status === 401) throw new Error("Discord не знает этот вебхук: он удалён или ссылка неверная");
  if (!res.ok) throw new Error(`Discord ответил ${res.status}`);
  const body = (await res.json()) as { name?: string };
  return body.name ?? "вебхук";
}
