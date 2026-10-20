import { prisma, recordEvent, type EventLevelName, type Prisma } from "@flamebot/core";

export const BOT_KEY = "online";

export function event(
  type: string,
  message: string,
  opts: { level?: EventLevelName; details?: Prisma.InputJsonValue } = {},
): void {
  void recordEvent(prisma, { botKey: BOT_KEY, type, message, ...opts });
}

const recent = new Map<string, number>();

// Предупреждения и ошибки: одинаковые не чаще раза в 5 минут, чтобы лежащий сервер
// не засыпал историю одинаковыми записями.
export function log(level: "info" | "warn" | "error", message: string, err?: unknown): void {
  const line = `${new Date().toISOString()} [${level}] ${message}`;
  const detail = err instanceof Error ? `${err.name}: ${err.message}` : err === undefined ? "" : String(err);
  (level === "error" ? console.error : level === "warn" ? console.warn : console.log)(detail ? `${line} — ${detail}` : line);
  if (level === "info") return;
  const now = Date.now();
  if ((recent.get(message) ?? 0) > now - 5 * 60_000) return;
  recent.set(message, now);
  event(level === "error" ? "bot.error" : "bot.warn", message, {
    level: level === "error" ? "ERROR" : "WARN",
    details: detail ? { error: detail.slice(0, 500) } : undefined,
  });
}
