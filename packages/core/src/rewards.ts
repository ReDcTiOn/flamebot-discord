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

// Опыт за одно начисление: при целых границах — целое число, как в JuniperBot (15–24), иначе с сотыми.
export function randomAward(min: number, max: number): number {
  if (Number.isInteger(min) && Number.isInteger(max)) return min + Math.floor(Math.random() * (max - min + 1));
  return randomHundredths(min, max);
}

// Случайное число в диапазоне с шагом 0.01.
export function randomHundredths(min: number, max: number): number {
  const lo = Math.round(min * 100);
  const hi = Math.round(max * 100);
  return round2((lo + Math.floor(Math.random() * (hi - lo + 1))) / 100);
}
