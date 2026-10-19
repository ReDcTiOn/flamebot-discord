import { getRatingSettings, prisma, type Rank, type RatingSettings } from "@flamebot/core";

// Настройки меняются из панели, бот перечитывает их не реже раза в TTL.
const TTL_MS = 15_000;

let cache: { settings: RatingSettings; ranks: Rank[]; at: number } | null = null;
let inflight: Promise<{ settings: RatingSettings; ranks: Rank[] }> | null = null;

export async function getState(): Promise<{ settings: RatingSettings; ranks: Rank[] }> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache;
  if (!inflight) {
    inflight = (async () => {
      const [settings, ranks] = await Promise.all([
        getRatingSettings(prisma),
        prisma.rank.findMany({ orderBy: { minXp: "asc" } }),
      ]);
      cache = { settings, ranks, at: Date.now() };
      return cache;
    })().finally(() => {
      inflight = null;
    });
  }
  return inflight;
}
