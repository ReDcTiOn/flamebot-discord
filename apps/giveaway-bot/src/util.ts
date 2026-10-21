import { getGiveawaySettings, prisma, type GiveawaySettings } from "@flamebot/core";

// Настройки меняются из панели, бот перечитывает их не реже раза в TTL.
const TTL_MS = 15_000;
let cache: { settings: GiveawaySettings; at: number } | null = null;

export async function getSettings(): Promise<GiveawaySettings> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.settings;
  const settings = await getGiveawaySettings(prisma);
  cache = { settings, at: Date.now() };
  return settings;
}

// Последовательное выполнение задач по ключу. Подведение итогов, реролл и отмена
// одного розыгрыша не должны идти одновременно.
const chains = new Map<string, Promise<unknown>>();

export async function withLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const prev = chains.get(key) ?? Promise.resolve();
  const run = prev.catch(() => undefined).then(fn);
  chains.set(key, run);
  try {
    return await run;
  } finally {
    if (chains.get(key) === run) chains.delete(key);
  }
}

// Простой ограничитель частоты: не больше `limit` событий за `windowMs` на ключ.
export class RateLimiter {
  private hits = new Map<string, number[]>();

  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
  ) {
    setInterval(() => this.cleanup(), windowMs * 2).unref();
  }

  take(key: string): boolean {
    const now = Date.now();
    const list = (this.hits.get(key) ?? []).filter((t) => now - t < this.windowMs);
    if (list.length >= this.limit) {
      this.hits.set(key, list);
      return false;
    }
    list.push(now);
    this.hits.set(key, list);
    return true;
  }

  private cleanup() {
    const now = Date.now();
    for (const [key, list] of this.hits) {
      if (list.every((t) => now - t >= this.windowMs)) this.hits.delete(key);
    }
  }
}

export const mentions = (ids: readonly string[]) => ids.map((id) => `<@${id}>`).join(", ");
export const unix = (d: Date) => Math.floor(d.getTime() / 1000);
