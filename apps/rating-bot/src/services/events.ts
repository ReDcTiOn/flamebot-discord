import { prisma, recordEvent, type EventLevelName } from "@flamebot/core";
import type { Prisma } from "@flamebot/core";

const BOT_KEY = "rating";

// Запись в историю без ожидания: событие не должно тормозить ответ игроку.
export function event(
  type: string,
  message: string,
  opts: { level?: EventLevelName; memberId?: string | null; details?: Prisma.InputJsonValue } = {},
): void {
  void recordEvent(prisma, { botKey: BOT_KEY, type, message, ...opts });
}

// Предупреждения и ошибки из лога. Одинаковые сообщения не чаще раза в минуту,
// всего не больше 30 в минуту — чтобы сбой не завалил базу.
const recent = new Map<string, number>();
let windowStart = Date.now();
let windowCount = 0;

export function logEvent(level: "WARN" | "ERROR", message: string, err?: unknown): void {
  const now = Date.now();
  if (now - windowStart > 60_000) {
    windowStart = now;
    windowCount = 0;
    for (const [k, t] of recent) if (now - t > 60_000) recent.delete(k);
  }
  const key = `${level}:${message}`;
  if ((recent.get(key) ?? 0) > now - 60_000 || windowCount >= 30) return;
  recent.set(key, now);
  windowCount++;
  const error = err instanceof Error ? { name: err.name, message: err.message.slice(0, 500) } : err === undefined ? undefined : String(err).slice(0, 500);
  event(level === "ERROR" ? "bot.error" : "bot.warn", message, { level, details: error === undefined ? undefined : { error } });
}
