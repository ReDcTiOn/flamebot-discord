import { prisma } from "@flamebot/core";

const STALE_MS = 3 * 60_000;

export type BotTone = "on" | "paused" | "pending" | "off";

export interface BotState {
  enabled: boolean; // что выбрано в панели
  tone: BotTone;
  label: string;
  changedByName: string | null;
}

// Состояние бота для панели: сравниваем, что выбрано (BotControl), с тем, что бот сообщает сам (BotStatus).
export async function getBotStates(keys: string[]): Promise<Record<string, BotState>> {
  const [controls, statuses] = await Promise.all([
    prisma.botControl.findMany({ where: { botKey: { in: keys } } }),
    prisma.botStatus.findMany({ where: { botKey: { in: keys } } }),
  ]);
  const result: Record<string, BotState> = {};
  for (const key of keys) {
    const control = controls.find((c) => c.botKey === key);
    const status = statuses.find((s) => s.botKey === key);
    const enabled = control?.enabled ?? true;
    const fresh = !!status && Date.now() - status.heartbeatAt.getTime() < STALE_MS;
    const running = status?.state === "running";

    let tone: BotTone;
    let label: string;
    if (!status) [tone, label] = ["off", "Не запускался"];
    else if (!fresh) [tone, label] = ["off", "Не отвечает"];
    else if (enabled && status.state === "failed") [tone, label] = ["off", "Ошибка входа в Discord"];
    else if (enabled && running) [tone, label] = ["on", "Работает"];
    else if (!enabled && !running) [tone, label] = ["paused", "Остановлен"];
    else if (!enabled) [tone, label] = ["pending", "Останавливается…"];
    else [tone, label] = ["pending", "Запускается…"];

    result[key] = { enabled, tone, label, changedByName: control?.changedByName ?? null };
  }
  return result;
}
