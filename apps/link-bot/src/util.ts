import type { Guild } from "discord.js";
import { getLinkSettings, prisma, type LinkSettings } from "@flamebot/core";

// Сервер Discord, пока бот к нему подключён. HTTP API выдаёт коды, только когда он есть:
// иначе игрок получит код, который некуда ввести.
export const live: { guild: Guild | null } = { guild: null };

// Настройки меняются из панели, бот перечитывает их не реже раза в TTL.
const TTL_MS = 15_000;
let cache: { settings: LinkSettings; at: number } | null = null;

export async function getSettings(): Promise<LinkSettings> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.settings;
  const settings = await getLinkSettings(prisma);
  cache = { settings, at: Date.now() };
  return settings;
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

  // Лимит уже исчерпан. Ничего не засчитывает.
  full(key: string): boolean {
    const now = Date.now();
    return (this.hits.get(key) ?? []).filter((t) => now - t < this.windowMs).length >= this.limit;
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

export const unix = (d: Date) => Math.floor(d.getTime() / 1000);
