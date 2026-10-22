import { prisma, recordEvent, type EventLevelName, type Prisma } from "@flamebot/core";

export const BOT_KEY = "link";

// Запись в историю без ожидания: событие не должно тормозить ответ игроку.
export function event(
  type: string,
  message: string,
  opts: { level?: EventLevelName; memberId?: string | null; details?: Prisma.InputJsonValue } = {},
): void {
  void recordEvent(prisma, { botKey: BOT_KEY, type, message, ...opts });
}

const recent = new Map<string, number>();

function write(level: "info" | "warn" | "error", message: string, err?: unknown) {
  const line = `${new Date().toISOString()} [${level}] ${message}`;
  const detail = err instanceof Error ? `${err.name}: ${err.message}` : err === undefined ? "" : String(err);
  (level === "error" ? console.error : level === "warn" ? console.warn : console.log)(detail ? `${line} — ${detail}` : line);
  if (level === "info") return;
  // Одинаковые предупреждения — не чаще раза в минуту, чтобы сбой не засыпал историю.
  const now = Date.now();
  if ((recent.get(message) ?? 0) > now - 60_000) return;
  recent.set(message, now);
  for (const [k, t] of recent) if (now - t > 60_000) recent.delete(k);
  event(level === "error" ? "bot.error" : "bot.warn", message, {
    level: level === "error" ? "ERROR" : "WARN",
    details: detail ? { error: detail.slice(0, 500) } : undefined,
  });
}

// Предупреждения и ошибки дублируются в историю событий, чтобы их было видно в панели.
export const log = {
  info: (m: string) => write("info", m),
  warn: (m: string, e?: unknown) => write("warn", m, e),
  error: (m: string, e?: unknown) => write("error", m, e),
};
