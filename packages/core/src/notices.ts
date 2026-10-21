import { z } from "zod";
import type { NoticeRule, NoticeSettings, NoticeTemplate, Prisma } from "@prisma/client";
import type { Db } from "./db.js";
import { addDays, isValidTimeZone, parseTime, today, weekday, zonedParts, type CalendarDate } from "./giveaways.js";
import { WEEKDAYS_FULL, WEEKDAYS_SHORT, clockSchema, isBlueprintWipe, isoDay, wipeDatetime } from "./maps.js";

// Общие правила модуля «Объявления о вайпах» (бот notice-bot и панель).

export const NOTICE_BOT_KEY = "notices";

export const NOTICE_KINDS = ["regular", "global"] as const;
export type NoticeKind = (typeof NOTICE_KINDS)[number];
export const NOTICE_KIND_LABEL: Record<NoticeKind, string> = { regular: "обычный", global: "глобальный" };
export const NOTICE_KIND_ICON: Record<NoticeKind, string> = { regular: "🟢", global: "🔴" };
export const NOTICE_KIND_NOTE: Record<NoticeKind, string> = { regular: "чертежи сохраняются", global: "чертежи удаляются" };

export const NOTICE_STATUS = {
  pending: "ждёт отправки",
  sending: "отправляется",
  sent: "отправлен",
  partial: "отправлен не везде",
  skipped: "отменён",
  missed: "пропущен",
} as const;
export type NoticeStatus = keyof typeof NOTICE_STATUS;

export const NOTICE_ACTION_LABEL: Record<string, string> = {
  "event.confirm": "Подтвердить текст",
  "event.template": "Сменить текст",
  "event.skip": "Не отправлять",
  "event.retry": "Повторить неудавшиеся",
  "test.start": "Тестовый прогон",
  "reminder.test": "Тестовое напоминание",
  "promos.list": "Промокоды gamestores",
  check: "Проверка подключений",
};

// ---------------------------------------------------------------- секреты

export const NOTICE_SECRETS = [
  { name: "telegramToken", label: "Токен бота Telegram", placeholder: "123456789:AA… от @BotFather", required: true },
  { name: "discordWebhook", label: "Вебхук Discord", placeholder: "https://discord.com/api/webhooks/…", required: true },
  { name: "vkToken", label: "Ключ сообщества ВКонтакте", placeholder: "Управление → Работа с API → Ключи доступа (стена, фотографии)", required: true },
  { name: "gamestoresSecretKey", label: "Секретный ключ gamestores", placeholder: "Из панели магазина gamestores.app", required: false },
  { name: "testDiscordWebhook", label: "Тестовый вебхук Discord", placeholder: "Для тестовых прогонов, необязательно", required: false },
  { name: "testVkToken", label: "Ключ тестового сообщества ВКонтакте", placeholder: "Для тестовых прогонов, необязательно", required: false },
] as const;

export type NoticeSecretName = (typeof NOTICE_SECRETS)[number]["name"];
export const NOTICE_SECRET_NAMES = NOTICE_SECRETS.map((s) => s.name) as NoticeSecretName[];
export const noticeSecretContext = (name: NoticeSecretName) => `notices:secret:${name}`;

const WEBHOOK_RE = /^https:\/\/(?:(?:ptb|canary)\.)?discord(?:app)?\.com\/api\/webhooks\/\d{17,20}\/[\w-]{20,}$/;

export function noticeSecretProblem(name: NoticeSecretName, value: string): string | null {
  const v = value.trim();
  if (v.length > 500) return "Слишком длинное значение";
  switch (name) {
    case "telegramToken":
      return /^\d{5,15}:[\w-]{30,}$/.test(v) ? null : "Это не похоже на токен Telegram: 123456789:AA… от @BotFather";
    case "discordWebhook":
    case "testDiscordWebhook":
      return WEBHOOK_RE.test(v) ? null : "Нужна ссылка вебхука вида https://discord.com/api/webhooks/…";
    case "vkToken":
    case "testVkToken":
      return /^[\w.-]{40,}$/.test(v) ? null : "Это не похоже на ключ доступа ВКонтакте";
    default:
      return v.length >= 8 ? null : "Слишком короткое значение";
  }
}

export function noticeSecretHint(name: NoticeSecretName, value: string): string {
  const v = value.trim();
  if (name === "discordWebhook" || name === "testDiscordWebhook") {
    const m = /\/webhooks\/(\d+)\/.*(.{4})$/.exec(v);
    return m ? `…/webhooks/${m[1]}/…${m[2]}` : `…${v.slice(-4)}`;
  }
  if (name === "telegramToken") return `бот ${v.split(":")[0]}, …${v.slice(-4)}`;
  return `…${v.slice(-4)}`;
}

// ---------------------------------------------------------------- расписание

export interface NoticeWipe {
  key: string; // местное время вайпа «2026-10-22T17:00»
  rule: NoticeRule;
  wipeAt: Date;
  kind: NoticeKind;
}

const pad = (n: number) => String(n).padStart(2, "0");

// Ключ события — местное время вайпа: так же называл события прежний бот, и импорт их не задвоит.
export function noticeKey(wipeAt: Date, timezone: string): string {
  const p = zonedParts(wipeAt, timezone);
  return `${p.year}-${pad(p.month)}-${pad(p.day)}T${pad(p.hour)}:${pad(p.minute)}`;
}

export function noticeKindAt(rule: NoticeRule, wipeAt: Date, timezone: string): NoticeKind {
  return isBlueprintWipe(rule, wipeAt, timezone) ? "global" : "regular";
}

// Все вайпы со временем в [start, end] по возрастанию. Два правила на одно время дают один вайп.
export function noticeWipesBetween(rules: NoticeRule[], timezone: string, start: Date, end: Date): NoticeWipe[] {
  const result = new Map<string, NoticeWipe>();
  let day = addDays(today(timezone, start), -1);
  const last = addDays(today(timezone, end), 1);
  for (let i = 0; i < 4000 && dayIndex(day) <= dayIndex(last); i++, day = addDays(day, 1)) {
    for (const rule of rules) {
      if (!rule.enabled || rule.weekday !== weekday(day)) continue;
      const wipeAt = wipeDatetime(rule, day, timezone);
      if (wipeAt < start || wipeAt > end) continue;
      const key = noticeKey(wipeAt, timezone);
      if (!result.has(key)) result.set(key, { key, rule, wipeAt, kind: noticeKindAt(rule, wipeAt, timezone) });
    }
  }
  return [...result.values()].sort((a, b) => a.wipeAt.getTime() - b.wipeAt.getTime());
}

const dayIndex = (d: CalendarDate) => Date.UTC(d.year, d.month - 1, d.day);

// Вайп в этот местный день (для подстановок в плане дня). Первый по времени, если их несколько.
export function noticeWipeOn(rules: NoticeRule[], timezone: string, day: CalendarDate): NoticeWipe | null {
  for (const rule of [...rules].sort((a, b) => a.time.localeCompare(b.time))) {
    if (!rule.enabled || rule.weekday !== weekday(day)) continue;
    const wipeAt = wipeDatetime(rule, day, timezone);
    return { key: noticeKey(wipeAt, timezone), rule, wipeAt, kind: noticeKindAt(rule, wipeAt, timezone) };
  }
  return null;
}

export function defaultTemplateId(rule: Pick<NoticeRule, "regularTemplateId" | "globalTemplateId">, kind: NoticeKind): string | null {
  return kind === "global" ? rule.globalTemplateId : rule.regularTemplateId;
}

// Вт 06.10 14:00
export function fmtNoticeStamp(d: Date, timezone: string): string {
  const p = zonedParts(d, timezone);
  const wd = WEEKDAYS_SHORT[p.weekday]!;
  return `${wd[0]!.toUpperCase()}${wd.slice(1)} ${pad(p.day)}.${pad(p.month)} ${pad(p.hour)}:${pad(p.minute)}`;
}

// ---------------------------------------------------------------- тексты

// Подставляет {date} {time} {weekday} {ts} во все строки тела вебхука и в текст ВКонтакте.
export function renderNotice(tpl: Pick<NoticeTemplate, "discord" | "vk">, wipeAt: Date, timezone: string): { discord: Record<string, unknown>; vk: string } {
  const p = zonedParts(wipeAt, timezone);
  const subs: [string, string][] = [
    ["{date}", `${pad(p.day)}.${pad(p.month)}`],
    ["{time}", `${pad(p.hour)}:${pad(p.minute)}`],
    ["{weekday}", WEEKDAYS_FULL[p.weekday]!],
    ["{ts}", String(Math.floor(wipeAt.getTime() / 1000))],
  ];
  const sub = (v: unknown): unknown => {
    if (typeof v === "string") return subs.reduce((acc, [k, val]) => acc.replaceAll(k, val), v);
    if (Array.isArray(v)) return v.map(sub);
    if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, sub(x)]));
    return v;
  };
  return { discord: sub(tpl.discord) as Record<string, unknown>, vk: sub(tpl.vk) as string };
}

// ---------------------------------------------------------------- промокод

export interface PromoSpec {
  code: string;
  type: string;
  amount: number;
  dateEnd: string; // «2026-10-07 23:59» по времени модуля
  limitUses: number;
}

// Промокод действует до end_time через days_after суток после дня вайпа (вт → ср 23:59, пт → сб 23:59).
export function buildPromoSpec(
  s: Pick<NoticeSettings, "promoCode" | "promoType" | "promoDaysAfter" | "promoEndTime" | "promoLimitUses" | "timezone">,
  amount: number,
  wipeAt: Date,
): PromoSpec {
  const p = zonedParts(wipeAt, s.timezone);
  const end = addDays({ year: p.year, month: p.month, day: p.day }, s.promoDaysAfter);
  return { code: s.promoCode, type: s.promoType, amount, dateEnd: `${isoDay(end)} ${s.promoEndTime}`, limitUses: s.promoLimitUses };
}

// «2026-10-07 23:59» → «Ср 07.10 23:59»
export function fmtPromoEnd(dateEnd: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}:\d{2})$/.exec(dateEnd);
  if (!m) return dateEnd;
  const wd = WEEKDAYS_SHORT[weekday({ year: Number(m[1]), month: Number(m[2]), day: Number(m[3]) })]!;
  return `${wd[0]!.toUpperCase()}${wd.slice(1)} ${m[3]}.${m[2]} ${m[4]}`;
}

// ---------------------------------------------------------------- проверка полей

const tgId = z.string().regex(/^\d{1,15}$/, "Telegram ID — только цифры");
const vkPhoto = z
  .string()
  .trim()
  .transform((v, ctx) => {
    const m = /(-?\d+_\d+)/.exec(v);
    if (!m) {
      ctx.addIssue({ code: "custom", message: "Фото ВКонтакте — ID вида photo-123_456 или ссылка на него" });
      return z.NEVER;
    }
    return `photo${m[1]}`;
  });

export function parseVkPhoto(raw: string): string | null {
  const m = /(-?\d+_\d+)/.exec(raw);
  return m ? `photo${m[1]}` : null;
}

export const noticeSettingsSchema = z.object({
  timezone: z.string().trim().refine(isValidTimeZone, "Неизвестный часовой пояс, пример: Europe/Moscow"),
  timezoneLabel: z.string().trim().min(1).max(20),
  notifyMinutes: z.number().int().min(10, "Присылать на подтверждение — не раньше чем за 10 минут").max(72 * 60),
  remindMinutes: z.number().int().min(0).max(24 * 60),
  maxLateMinutes: z.number().int().min(1).max(24 * 60),
  dryRun: z.boolean(),
  telegramAdminIds: z.array(tgId).max(20),
  vkGroupId: z.number().int().positive().nullable(),
  vkPhotoRegular: vkPhoto.nullable(),
  vkPhotoGlobal: vkPhoto.nullable(),
  testVkGroupId: z.number().int().positive().nullable(),
  testVkPhotoRegular: vkPhoto.nullable(),
  testVkPhotoGlobal: vkPhoto.nullable(),
  gamestoresStoreId: z.string().trim().max(64).nullable(),
  promoCode: z.string().trim().regex(/^[\w-]{2,32}$/, "Код промокода — от 2 до 32 латинских букв, цифр, _ и -"),
  promoType: z.enum(["discount", "money", "item"]),
  promoDaysAfter: z.number().int().min(0).max(30),
  promoEndTime: clockSchema,
  promoLimitUses: z.number().int().min(0).max(100_000),
  promoTestReal: z.boolean(),
  agendaEnabled: z.boolean(),
  agendaSendAt: clockSchema,
  agendaGraceMinutes: z.number().int().min(0).max(24 * 60),
  agendaGreeting: z.string().trim().min(1).max(100),
}).refine((s) => s.remindMinutes < s.notifyMinutes, {
  message: "Напоминание должно приходить позже первого сообщения",
  path: ["remindMinutes"],
});

export const noticeTemplateSchema = z.object({
  id: z.string().trim().regex(/^[A-Za-z0-9_-]{1,32}$/, "ID текста — латиница, цифры, _ и - (до 32 символов)"),
  title: z.string().trim().min(1, "Укажи название").max(80),
  kind: z.enum(NOTICE_KINDS),
  discord: z
    .record(z.string(), z.unknown())
    .refine((t) => (Array.isArray(t.embeds) && t.embeds.length > 0) || (typeof t.content === "string" && t.content.trim() !== ""), "В Discord нужен хотя бы embeds или content")
    .refine((t) => JSON.stringify(t).length <= 6000, "Сообщение для Discord слишком большое"),
  vk: z.string().trim().min(1, "Текст для ВКонтакте пустой").max(15_000),
  promoAmount: z.number().int().min(1, "Скидка — от 1").max(100, "Скидка — до 100").nullable(),
  sortOrder: z.number().int().min(-1000).max(1000),
});

export const noticeRuleSchema = z
  .object({
    key: z.string().trim().regex(/^[a-z0-9_-]{1,20}$/, "Ключ правила — латиница в нижнем регистре, цифры, - и _ (до 20 символов)"),
    weekday: z.number().int().min(0).max(6),
    time: clockSchema,
    forceTimezone: z.string().trim().refine(isValidTimeZone, "Неизвестный часовой пояс").nullable(),
    forceTime: clockSchema.nullable(),
    bpFirstOfMonth: z.boolean(),
    bpEveryDays: z.number().int().min(0).max(365),
    bpAnchor: z.date().nullable(),
    regularTemplateId: z.string().nullable(),
    globalTemplateId: z.string().nullable(),
    enabled: z.boolean(),
  })
  .refine((r) => !r.forceTimezone === !r.forceTime, { message: "Для форс-вайпа нужны и пояс, и время", path: ["forceTime"] })
  .refine((r) => r.bpEveryDays === 0 || r.bpAnchor !== null, {
    message: "Для глобального вайпа раз в N дней укажи дату последнего глобального вайпа",
    path: ["bpAnchor"],
  });

export type NoticeRuleInput = z.infer<typeof noticeRuleSchema>;

// Чего не хватает правилу: текстов по умолчанию для тех типов вайпа, что по нему бывают.
export function noticeRuleProblems(
  rule: Pick<NoticeRule, "bpFirstOfMonth" | "bpEveryDays" | "regularTemplateId" | "globalTemplateId">,
  templates: Pick<NoticeTemplate, "id" | "kind">[],
): string[] {
  const byId = new Map(templates.map((t) => [t.id, t]));
  const problems: string[] = [];
  const canGlobal = rule.bpFirstOfMonth || rule.bpEveryDays > 0;
  const alwaysGlobal = rule.bpEveryDays === 1;
  const check = (kind: NoticeKind, id: string | null) => {
    if (!id) return problems.push(`Не выбран текст для ${kind === "global" ? "глобального" : "обычного"} вайпа`);
    const t = byId.get(id);
    if (!t) return problems.push(`Текста «${id}» нет`);
    if (t.kind !== kind) return problems.push(`Текст «${t.id}» для другого типа вайпа`);
  };
  if (!alwaysGlobal) check("regular", rule.regularTemplateId);
  if (canGlobal) check("global", rule.globalTemplateId);
  return problems;
}

export const noticeAgendaDaySchema = z
  .array(z.string().trim().min(1).max(300, "Пункт плана — до 300 символов"))
  .max(20, "В плане дня — не больше 20 пунктов");

export const noticeReminderSchema = z.object({
  id: z.string().trim().regex(/^[a-z0-9_-]{1,20}$/, "ID напоминания — латиница в нижнем регистре, цифры, - и _ (до 20 символов)"),
  title: z.string().trim().min(1, "Укажи заголовок").max(100),
  text: z.string().trim().min(1, "Укажи текст").max(1000),
  button: z.string().trim().min(1).max(40),
  doneText: z.string().trim().min(1).max(200),
  days: z.array(z.number().int().min(0).max(6)).min(1, "Выбери хотя бы один день"),
  times: z
    .array(clockSchema)
    .min(1, "Укажи хотя бы одно время")
    .max(12)
    .transform((t) => [...new Set(t)].sort()),
  graceMinutes: z.number().int().min(1).max(24 * 60),
  enabled: z.boolean(),
  sortOrder: z.number().int().min(-1000).max(1000),
});

// «14:00, 15:00 16:00» → ["14:00", "15:00", "16:00"]; неверное время остаётся как есть, его отвергнет схема.
export function parseTimes(text: string): string[] {
  return text
    .split(/[\s,;]+/)
    .filter(Boolean)
    .map((t) => {
      const c = parseTime(t);
      return c ? `${pad(c.hour)}:${pad(c.minute)}` : t;
    });
}

// ---------------------------------------------------------------- стартовые данные (как в прежнем боте)

// Расписание прежнего бота: вт 14:00, чт 17:00 (в первый четверг — форс-вайп Facepunch, 14:00 по Нью-Йорку,
// глобальный), пт 14:00 (глобальный раз в две недели от 2 октября 2026). Тексты подставит импорт.
export const DEFAULT_NOTICE_RULES: Prisma.NoticeRuleCreateInput[] = [
  { key: "tuesday", weekday: 1, time: "14:00" },
  { key: "thursday", weekday: 3, time: "17:00", forceTimezone: "America/New_York", forceTime: "14:00", bpFirstOfMonth: true },
  { key: "friday", weekday: 4, time: "14:00", bpEveryDays: 14, bpAnchor: new Date(Date.UTC(2026, 9, 2)) },
];

export async function getNoticeSettings(db: Db): Promise<NoticeSettings> {
  return db.noticeSettings.upsert({ where: { id: 1 }, update: {}, create: { id: 1 } });
}

export async function ensureNoticeDefaults(db: Db): Promise<void> {
  await getNoticeSettings(db);
  if ((await db.noticeRule.count()) === 0) {
    for (const data of DEFAULT_NOTICE_RULES) await db.noticeRule.upsert({ where: { key: data.key }, create: data, update: {} });
  }
}
