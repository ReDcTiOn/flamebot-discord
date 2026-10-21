import { round2 } from "./db.js";
import type { Rank, RatingSettings } from "./types.js";

export interface MessageReward {
  xpMin: number;
  xpMax: number;
  scrap: number;
}

// Сколько даёт одно сообщение на этом ранге: свои значения ранга или общие настройки.
export function messageReward(settings: Pick<RatingSettings, "xpMin" | "xpMax" | "scrapPerAward">, rank: Pick<Rank, "xpMin" | "xpMax" | "scrapPerMessage"> | null): MessageReward {
  const own = rank && rank.xpMin !== null && rank.xpMax !== null;
  return {
    xpMin: own ? rank.xpMin! : settings.xpMin,
    xpMax: own ? rank.xpMax! : settings.xpMax,
    scrap: rank?.scrapPerMessage ?? settings.scrapPerAward,
  };
}

// Случайное число в диапазоне с шагом 0.01.
export function randomHundredths(min: number, max: number): number {
  const lo = Math.round(min * 100);
  const hi = Math.round(max * 100);
  return round2((lo + Math.floor(Math.random() * (hi - lo + 1))) / 100);
}

type SimRank = Pick<Rank, "minXp" | "xpMin" | "xpMax" | "scrapPerMessage" | "scrapReward">;

// Сколько опыта и скрапа набрал бы участник за `messages` засчитанных сообщений, начиная с нуля:
// каждое сообщение даёт среднее начисление текущего ранга, а с новым рангом растёт и ставка.
// Нужен для переноса опыта из других ботов «как если бы человек писал у нас».
export function simulateMessages(
  messages: number,
  settings: Pick<RatingSettings, "xpMin" | "xpMax" | "scrapPerAward">,
  ranks: readonly SimRank[],
): { xp: number; scrap: number; rankRewards: number } {
  const sortedRanks = [...ranks].sort((a, b) => a.minXp - b.minXp);
  let xp = 0;
  let scrap = 0;
  let rankRewards = 0;
  let left = Math.max(0, Math.floor(messages));
  while (left > 0) {
    const currentIdx = sortedRanks.findLastIndex((r) => r.minXp <= xp);
    const current = currentIdx >= 0 ? sortedRanks[currentIdx]! : null;
    const next = sortedRanks[currentIdx + 1] ?? null;
    const reward = messageReward(settings, current);
    const perMessage = (reward.xpMin + reward.xpMax) / 2;
    // До следующего ранга — столько сообщений, дальше ставка меняется.
    const toNext = next && perMessage > 0 ? Math.max(1, Math.ceil((next.minXp - xp) / perMessage - 1e-9)) : left;
    const steps = Math.min(left, toNext);
    xp += steps * perMessage;
    scrap += steps * reward.scrap;
    left -= steps;
    if (next && xp + 1e-9 >= next.minXp) rankRewards += next.scrapReward;
    if (perMessage <= 0) break;
  }
  return { xp: round2(xp), scrap: round2(scrap), rankRewards };
}
