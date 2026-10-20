import type { PrismaClient } from "@prisma/client";

// Должен ли бот работать. Записи нет — значит включён.
export async function isBotEnabled(db: PrismaClient, botKey: string): Promise<boolean> {
  const row = await db.botControl.findUnique({ where: { botKey } });
  return row?.enabled ?? true;
}

// running — работает, paused — остановлен из панели, failed — включён, но не смог войти в Discord.
export async function reportBotState(db: PrismaClient, botKey: string, state: "running" | "paused" | "failed"): Promise<void> {
  await db.botStatus.upsert({
    where: { botKey },
    create: { botKey, heartbeatAt: new Date(), state },
    update: { heartbeatAt: new Date(), state },
  });
}
