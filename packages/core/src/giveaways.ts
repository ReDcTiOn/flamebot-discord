import { z } from "zod";
import type { GiveawaySettings } from "@prisma/client";
import type { Db } from "./db.js";

// Общие правила модуля «Розыгрыши»: разбор даты и времени, часовые пояса, проверка настроек.
// Всё здесь без Discord, чтобы панель и бот считали одинаково.

export const GIVEAWAY_MAX_WINNERS = 20;
export const GIVEAWAY_MAX_DAYS = 365;

export interface CalendarDate {
  year: number;
  month: number; // 1–12
  day: number;
}

export interface ClockTime {
  hour: number;
  minute: number;
}

export interface ZonedParts extends CalendarDate, ClockTime {
  weekday: number; // 0 — понедельник, 6 — воскресенье
}

export function plural(n: number, one: string, few: string, many: string): string {
  const n100 = Math.abs(n) % 100;
  if (n100 >= 11 && n100 <= 19) return many;
  const n10 = n100 % 10;
  if (n10 === 1) return one;
  if (n10 >= 2 && n10 <= 4) return few;
  return many;
}

export function isValidTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone });
    return true;
  } catch {
    return false;
  }
}

const formatters = new Map<string, Intl.DateTimeFormat>();
const WEEKDAY_INDEX: Record<string, number> = { Mon: 0, Tue: 1, Wed: 2, Thu: 3, Fri: 4, Sat: 5, Sun: 6 };

// Дата и время на часах в указанном часовом поясе.
export function zonedParts(date: Date, timeZone: string): ZonedParts {
  let f = formatters.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "numeric",
      day: "numeric",
      hour: "numeric",
      minute: "numeric",
      weekday: "short",
    });
    formatters.set(timeZone, f);
  }
  const parts = Object.fromEntries(f.formatToParts(date).map((p) => [p.type, p.value]));
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour),
    minute: Number(parts.minute),
    weekday: WEEKDAY_INDEX[parts.weekday ?? ""] ?? 0,
  };
}

// Смещение пояса от UTC в миллисекундах в момент t.
function offsetAt(t: number, timeZone: string): number {
  const p = zonedParts(new Date(t), timeZone);
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute) - Math.floor(t / 60_000) * 60_000;
}

// Момент времени, когда в поясе timeZone на часах указанные дата и время.
export function zonedToDate(date: CalendarDate, time: ClockTime, timeZone: string): Date {
  const wall = Date.UTC(date.year, date.month - 1, date.day, time.hour, time.minute);
  let t = wall - offsetAt(wall, timeZone);
  // При переходе на летнее время смещение в искомый момент может отличаться от первой догадки.
  const second = wall - offsetAt(t, timeZone);
  if (second !== t) t = second;
  return new Date(t);
}

export function today(timeZone: string, now = new Date()): CalendarDate {
  const { year, month, day } = zonedParts(now, timeZone);
  return { year, month, day };
}

export function addDays(d: CalendarDate, days: number): CalendarDate {
  const t = new Date(Date.UTC(d.year, d.month - 1, d.day + days));
  return { year: t.getUTCFullYear(), month: t.getUTCMonth() + 1, day: t.getUTCDate() };
}

export function compareDates(a: CalendarDate, b: CalendarDate): number {
  return (a.year - b.year) * 10_000 + (a.month - b.month) * 100 + (a.day - b.day);
}

export function weekday(d: CalendarDate): number {
  return (new Date(Date.UTC(d.year, d.month - 1, d.day)).getUTCDay() + 6) % 7;
}

function makeDate(year: number, month: number, day: number): CalendarDate | null {
  const t = new Date(Date.UTC(year, month - 1, day));
  if (t.getUTCFullYear() !== year || t.getUTCMonth() !== month - 1 || t.getUTCDate() !== day) return null;
  return { year, month, day };
}

const DIGITS = /^\d+$/;

// Понимает 30.09.2026, 30.09.26, 30.09 (ближайшее такое число), 30/09.
export function parseDate(text: string, now: CalendarDate): CalendarDate | null {
  const first = text.trim().split(/\s+/)[0] ?? "";
  if (!first) return null;
  const parts = first.replaceAll("/", ".").replaceAll(",", ".").split(".").filter(Boolean);
  if (!parts.every((p) => DIGITS.test(p))) return null;
  const nums = parts.map(Number);
  if (nums.length === 2) {
    const [day, month] = nums as [number, number];
    const result = makeDate(now.year, month, day);
    if (result && compareDates(result, now) < 0) return makeDate(now.year + 1, month, day);
    return result;
  }
  if (nums.length === 3) {
    const [day, month, year] = nums as [number, number, number];
    return makeDate(year < 100 ? year + 2000 : year, month, day);
  }
  return null;
}

function makeTime(hour: number, minute: number): ClockTime | null {
  return hour >= 0 && hour <= 23 && minute >= 0 && minute <= 59 ? { hour, minute } : null;
}

// Понимает 20:00, 20.00, 20 00, 2000, 20.
export function parseTime(text: string): ClockTime | null {
  const t = text.trim().replaceAll(".", ":").replaceAll(" ", ":");
  if (!t) return null;
  if (t.includes(":")) {
    const i = t.indexOf(":");
    const hour = t.slice(0, i);
    const minute = t.slice(i + 1) || "0";
    if (!DIGITS.test(hour) || !DIGITS.test(minute)) return null;
    return makeTime(Number(hour), Number(minute));
  }
  if (!DIGITS.test(t)) return null;
  if (t.length <= 2) return makeTime(Number(t), 0);
  if (t.length <= 4) return makeTime(Number(t.slice(0, -2)), Number(t.slice(-2)));
  return null;
}

// Промокоды столбиком: по одному в строке, пустые строки пропускаются.
export function parseCodes(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
}

// Что не так с промокодами: по одному на победителя, без повторов. null — всё в порядке.
export function promoCodesProblem(codes: string[], winners: number): string | null {
  if (codes.length !== winners) {
    return `Победителей ${winners}, значит нужно ${winners} ${plural(winners, "промокод", "промокода", "промокодов")}, а вставлено ${codes.length}.`;
  }
  if (new Set(codes).size !== codes.length) return "Среди промокодов есть повторы.";
  if (codes.some((c) => c.length > 100)) return "Промокод не может быть длиннее 100 символов.";
  return null;
}

const pad = (n: number) => String(n).padStart(2, "0");
export const formatDate = (d: CalendarDate) => `${pad(d.day)}.${pad(d.month)}.${d.year}`;
export const formatTime = (t: ClockTime) => `${pad(t.hour)}:${pad(t.minute)}`;

// 30.09.2026 20:00 — дата и время итогов так, как их видят админы в своём поясе.
export function formatInZone(date: Date, timeZone: string): string {
  const p = zonedParts(date, timeZone);
  return `${formatDate(p)} ${formatTime(p)}`;
}

export const giveawaySettingsSchema = z.object({
  timezone: z
    .string()
    .trim()
    .min(1)
    .max(64)
    .refine(isValidTimeZone, "Неизвестный часовой пояс. Пример: Asia/Vladivostok или Europe/Moscow"),
  timezoneLabel: z.string().trim().min(1, "Укажи подпись часового пояса").max(40),
  // Discord пропускает до 2000 символов, часть места занимают приз и промокод.
  promoDmText: z
    .string()
    .trim()
    .min(1)
    .max(1700, "Сообщение слишком длинное: не больше 1700 символов")
    .refine((v) => v.includes("{code}"), "В сообщении должен быть {code}, иначе победитель не увидит промокод"),
  quickPrize: z.string().trim().min(1, "Укажи приз").max(200),
  quickWinners: z.number().int().min(1).max(GIVEAWAY_MAX_WINNERS),
  quickDaysAhead: z.number().int().min(0).max(60),
  quickTime: z
    .string()
    .transform((v, ctx) => {
      const t = parseTime(v);
      if (!t) {
        ctx.addIssue({ code: "custom", message: "Время итогов — в формате ЧЧ:ММ, например 23:00" });
        return z.NEVER;
      }
      return formatTime(t);
    }),
  quickBoostersOnly: z.boolean(),
});

export async function getGiveawaySettings(db: Db): Promise<GiveawaySettings> {
  return db.giveawaySettings.upsert({ where: { id: 1 }, update: {}, create: { id: 1 } });
}
