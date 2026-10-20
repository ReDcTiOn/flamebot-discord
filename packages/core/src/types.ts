import type {
  DailyStat as PDailyStat,
  Member as PMember,
  Rank as PRank,
  RatingSettings as PRatingSettings,
} from "@prisma/client";

// Типы моделей так, как их отдаёт наш клиент базы: десятичные поля уже number (см. db.ts).
export type Member = Omit<PMember, "xp" | "scrap"> & { xp: number; scrap: number };
export type RatingSettings = Omit<PRatingSettings, "xpMin" | "xpMax" | "scrapPerAward"> & {
  xpMin: number;
  xpMax: number;
  scrapPerAward: number;
};
export type Rank = Omit<PRank, "xpMin" | "xpMax" | "scrapPerMessage"> & {
  xpMin: number | null;
  xpMax: number | null;
  scrapPerMessage: number | null;
};
export type DailyStat = Omit<PDailyStat, "xpAwarded"> & { xpAwarded: number };
