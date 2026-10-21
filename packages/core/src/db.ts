import { PrismaClient } from "@prisma/client";

// Опыт и скрап хранятся в базе как DECIMAL с точностью до сотых (без ошибок округления
// float при сложении копеек). В коде удобнее обычные числа, поэтому клиент сразу
// превращает эти поля в number. Значения до миллиардов с двумя знаками number хранит точно.
const num = (v: unknown) => Number(v);
const numOrNull = (v: unknown) => (v === null || v === undefined ? null : Number(v));

function createClient() {
  return new PrismaClient({
    log: process.env.NODE_ENV === "production" ? ["error"] : ["warn", "error"],
  }).$extends({
    result: {
      member: {
        xp: { needs: { xp: true }, compute: (m) => num(m.xp) },
        scrap: { needs: { scrap: true }, compute: (m) => num(m.scrap) },
        voiceXp: { needs: { voiceXp: true }, compute: (m) => num(m.voiceXp) },
      },
      ratingSettings: {
        xpMin: { needs: { xpMin: true }, compute: (s) => num(s.xpMin) },
        xpMax: { needs: { xpMax: true }, compute: (s) => num(s.xpMax) },
        scrapPerAward: { needs: { scrapPerAward: true }, compute: (s) => num(s.scrapPerAward) },
      },
      rank: {
        xpMin: { needs: { xpMin: true }, compute: (r) => numOrNull(r.xpMin) },
        xpMax: { needs: { xpMax: true }, compute: (r) => numOrNull(r.xpMax) },
        scrapPerMessage: { needs: { scrapPerMessage: true }, compute: (r) => numOrNull(r.scrapPerMessage) },
      },
      dailyStat: {
        xpAwarded: { needs: { xpAwarded: true }, compute: (d) => num(d.xpAwarded) },
      },
    },
  });
}

export type Db = ReturnType<typeof createClient>;

const globalForPrisma = globalThis as unknown as { flamebotPrisma?: Db };

// В dev-режиме Next.js перезагружает модули, поэтому клиент держим в globalThis,
// чтобы не плодить подключения к базе.
export const prisma: Db = globalForPrisma.flamebotPrisma ?? createClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.flamebotPrisma = prisma;
}

// Округление до сотых: всё, что пишется в опыт и скрап, проходит через него.
export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
