import { prisma } from "@flamebot/core";

const STALE_MS = 3 * 60_000;
const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

// У этих модулей есть раздел «Подключение», где чинится вход в Discord.
const CONNECTION_PAGES = new Set(["link", "rating", "giveaway", "maps", "notices"]);

export type BotTone = "on" | "paused" | "pending" | "off";

export interface BotState {
  enabled: boolean; // что выбрано в панели
  tone: BotTone;
  label: string;
  // Вторая строка: сколько работает, почему не работает или кто остановил.
  detail: string | null;
  // Не работает, хотя должен: строка подсвечивается, рядом кнопка, где это исправить.
  problem: boolean;
  fix: { href: string; label: string } | null;
}

// «2 д 4 ч», «3 ч 12 мин», «12 мин».
export function formatUptime(ms: number): string {
  if (ms < MIN) return "меньше минуты";
  const d = Math.floor(ms / DAY);
  const h = Math.floor((ms % DAY) / HOUR);
  const m = Math.floor((ms % HOUR) / MIN);
  if (d > 0) return h > 0 ? `${d} д ${h} ч` : `${d} д`;
  if (h > 0) return m > 0 ? `${h} ч ${m} мин` : `${h} ч`;
  return `${m} мин`;
}

function ago(ms: number): string {
  return ms < MIN ? "только что" : `${formatUptime(ms)} назад`;
}

// Состояние бота для панели: сравниваем, что выбрано (BotControl), с тем, что бот сообщает сам (BotStatus).
export async function getBotStates(keys: string[]): Promise<Record<string, BotState>> {
  const [controls, statuses] = await Promise.all([
    prisma.botControl.findMany({ where: { botKey: { in: keys } } }),
    prisma.botStatus.findMany({ where: { botKey: { in: keys } } }),
  ]);
  const now = Date.now();
  const result: Record<string, BotState> = {};
  for (const key of keys) {
    const control = controls.find((c) => c.botKey === key);
    const status = statuses.find((s) => s.botKey === key);
    const enabled = control?.enabled ?? true;
    const fresh = !!status && now - status.heartbeatAt.getTime() < STALE_MS;
    const running = status?.state === "running";
    const history = { href: `/${key}/events?level=problems`, label: "История" };

    let s: Omit<BotState, "enabled">;
    if (!status) {
      s = { tone: "off", label: "Не запускался", detail: "Сервис бота ещё ни разу не запускался", problem: true, fix: null };
    } else if (!fresh) {
      s = { tone: "off", label: "Не отвечает", detail: `Нет связи с сервисом бота ${formatUptime(now - status.heartbeatAt.getTime())}`, problem: true, fix: history };
    } else if (enabled && status.state === "failed") {
      const noToken = !!status.loginError && /не задан/i.test(status.loginError);
      s = {
        tone: "off",
        label: "Не работает",
        detail: status.loginError ?? "Не смог войти в Discord",
        problem: true,
        fix: CONNECTION_PAGES.has(key) ? { href: `/${key}/connection`, label: noToken ? "Указать токен" : "Подключение" } : history,
      };
    } else if (enabled && running) {
      s = { tone: "on", label: "Работает", detail: status.startedAt ? formatUptime(now - status.startedAt.getTime()) : null, problem: false, fix: null };
    } else if (!enabled && !running) {
      const who = control?.changedByName ? `Остановил ${control.changedByName}` : "Остановлен в панели";
      s = { tone: "paused", label: "Выключен", detail: control ? `${who} ${ago(now - control.updatedAt.getTime())}` : who, problem: false, fix: null };
    } else if (!enabled) {
      s = { tone: "pending", label: "Останавливается…", detail: null, problem: false, fix: null };
    } else {
      s = { tone: "pending", label: "Запускается…", detail: null, problem: false, fix: null };
    }
    result[key] = { enabled, ...s };
  }
  return result;
}
