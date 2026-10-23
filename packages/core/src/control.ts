import type { Db } from "./db.js";

// Должен ли бот работать. Записи нет — значит включён.
export async function isBotEnabled(db: Db, botKey: string): Promise<boolean> {
  const row = await db.botControl.findUnique({ where: { botKey } });
  return row?.enabled ?? true;
}

// С какого момента бот работает без перерыва — для «работает 2 д 4 ч» в панели.
// Хранится в памяти процесса: перезапуск контейнера начинает отсчёт заново.
const runningSince = new Map<string, Date>();

// running — работает, paused — остановлен из панели, failed — включён, но не смог войти в Discord.
export async function reportBotState(db: Db, botKey: string, state: "running" | "paused" | "failed"): Promise<void> {
  if (state !== "running") runningSince.delete(botKey);
  else if (!runningSince.has(botKey)) runningSince.set(botKey, new Date());
  const startedAt = runningSince.get(botKey) ?? null;
  await db.botStatus.upsert({
    where: { botKey },
    create: { botKey, heartbeatAt: new Date(), state, startedAt },
    update: { heartbeatAt: new Date(), state, startedAt },
  });
}
