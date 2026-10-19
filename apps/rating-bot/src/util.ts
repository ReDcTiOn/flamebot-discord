// Последовательное выполнение задач по ключу (обычно по id пользователя).
// Защищает от двойных кликов: две покупки или два /rep не пройдут одновременно.
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

export function progressBar(ratio: number, size = 12): string {
  const filled = Math.round(Math.min(1, Math.max(0, ratio)) * size);
  return "▰".repeat(filled) + "▱".repeat(size - filled);
}

export function formatDuration(ms: number): string {
  const totalMin = Math.max(1, Math.ceil(ms / 60_000));
  const days = Math.floor(totalMin / 1440);
  const hours = Math.floor((totalMin % 1440) / 60);
  const minutes = totalMin % 60;
  const parts: string[] = [];
  if (days) parts.push(`${days} д`);
  if (hours) parts.push(`${hours} ч`);
  if (minutes && !days) parts.push(`${minutes} мин`);
  return parts.join(" ");
}
