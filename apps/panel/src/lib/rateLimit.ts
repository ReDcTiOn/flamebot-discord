// Ограничитель частоты в памяти процесса. Для одной копии панели этого достаточно.
const buckets = new Map<string, number[]>();
let lastCleanup = Date.now();

export function rateLimit(key: string, limit: number, windowMs: number): boolean {
  const now = Date.now();
  if (now - lastCleanup > 60_000) {
    for (const [k, list] of buckets) if (list.every((t) => now - t > windowMs)) buckets.delete(k);
    lastCleanup = now;
  }
  const list = (buckets.get(key) ?? []).filter((t) => now - t < windowMs);
  if (list.length >= limit) {
    buckets.set(key, list);
    return false;
  }
  list.push(now);
  buckets.set(key, list);
  return true;
}
