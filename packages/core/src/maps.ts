import { z } from "zod";
import type { MapsServer, MapsWipeRule, Prisma } from "@prisma/client";
import type { Db } from "./db.js";
import {
  addDays,
  formatTime,
  isValidTimeZone,
  parseTime,
  today,
  weekday,
  zonedParts,
  zonedToDate,
  type CalendarDate,
} from "./giveaways.js";

// Общие правила модуля «Карты вайпов»: расписание, шаблоны анонса, проверка настроек,
// подписи статусов. Без сетевых вызовов, чтобы бот и панель считали одинаково.

export const MAPS_BOT_KEY = "maps";
export const WEEKDAYS_SHORT = ["пн", "вт", "ср", "чт", "пт", "сб", "вс"] as const;
export const WEEKDAYS_FULL = ["понедельник", "вторник", "среда", "четверг", "пятница", "суббота", "воскресенье"] as const;

// Циклы, в которых карты ещё можно менять.
export const MAPS_OPEN_CYCLES = ["generating", "awaiting_discord", "scheduled", "skipped"] as const;

export const MAPS_SLOT_STATUS: Record<string, string> = {
  waiting: "⏳ ждёт карту",
  ready: "🔎 на выборе",
  uploading: "⏳ загружается",
  uploaded: "✅ подтверждена",
  error: "❌ ошибка",
};
export const MAPS_CYCLE_STATUS: Record<string, string> = {
  generating: "карты на выборе",
  scheduled: "анонс запланирован",
  awaiting_discord: "ждёт отправки",
  skipped: "анонс отключён",
  sending: "отправляется",
  sent: "анонс отправлен",
};
export const MAPS_POOL_STATUS: Record<string, string> = {
  queued: "в очереди",
  generating: "генерируются",
  ready: "готовы",
  assigned: "выданы",
  rejected: "пропущены",
  error: "ошибки",
};
export const MAPS_PANEL_STATE: Record<string, string> = {
  idle: "ещё не спрашивали",
  pending: "ждёт ответа",
  done: "записаны",
  skipped: "не записываем",
};

// Подписи заданий боту из панели: для кнопок, журнала действий и истории бота.
export const MAPS_ACTION_LABEL: Record<string, string> = {
  "gen.start": "Генерация заранее",
  "slot.approve": "Подтвердить карту",
  "slot.reroll": "Заменить карту",
  "slot.back": "Вернуть предыдущую карту",
  "slot.manual": "Своя карта по ссылке",
  "cycle.unconfirm": "Снять подтверждения",
  "cycle.replaceAll": "Заменить все карты",
  "auto.start": "Подобрать автоматически",
  "auto.confirm": "Подтвердить набор автоподбора",
  "auto.reroll": "Перевыбрать автоматически",
  "auto.manual": "Выбрать самому",
  "discord.send": "Отправить анонс",
  "discord.skip": "Не отправлять анонс",
  "discord.prompt": "Вернуть отправку анонса",
  "discord.resend": "Отправить анонс повторно",
  "ptero.apply": "Записать ссылки в Pterodactyl",
  "ptero.skip": "Не записывать ссылки",
  "ptero.status": "Задачи вайпа в Pterodactyl",
  "global.toggle": "Глобальный / обычный вайп",
  check: "Проверка подключений",
};

// ---------------------------------------------------------------- секреты

export interface MapsSecretMeta {
  name: string;
  label: string;
  placeholder: string;
  required: boolean;
}

export const MAPS_SECRETS = [
  { name: "telegramToken", label: "Токен бота Telegram", placeholder: "123456789:AA… от @BotFather", required: false },
  { name: "rustmapsApiKey", label: "API-ключ RustMaps", placeholder: "rustmaps.com → профиль → API", required: true },
  { name: "s3AccessKey", label: "Access key S3", placeholder: "Selectel → Объектное хранилище → Доступ", required: true },
  { name: "s3SecretKey", label: "Secret key S3", placeholder: "Показывается один раз при создании ключа", required: true },
  { name: "discordWebhook", label: "Вебхук Discord", placeholder: "https://discord.com/api/webhooks/…", required: true },
  { name: "pteroApiKey", label: "Ключ клиента Pterodactyl", placeholder: "ptlc_… (Аккаунт → API Credentials)", required: false },
] as const satisfies readonly MapsSecretMeta[];

export type MapsSecretName = (typeof MAPS_SECRETS)[number]["name"];
export const MAPS_SECRET_NAMES = MAPS_SECRETS.map((s) => s.name) as MapsSecretName[];

export const mapsSecretContext = (name: MapsSecretName) => `maps:secret:${name}`;

// Проверка формата секрета до шифрования. Возвращает текст ошибки или null.
export function mapsSecretProblem(name: MapsSecretName, value: string): string | null {
  const v = value.trim();
  if (v.length > 500) return "Слишком длинное значение";
  switch (name) {
    case "telegramToken":
      return /^\d{5,15}:[\w-]{30,}$/.test(v) ? null : "Это не похоже на токен Telegram: 123456789:AA… от @BotFather";
    case "discordWebhook":
      return /^https:\/\/(?:(?:ptb|canary)\.)?discord(?:app)?\.com\/api\/webhooks\/\d{17,20}\/[\w-]{20,}$/.test(v)
        ? null
        : "Нужна ссылка вебхука вида https://discord.com/api/webhooks/…";
    case "pteroApiKey":
      if (!v.startsWith("ptlc_")) return "Нужен клиентский ключ ptlc_… (Аккаунт → API Credentials), ключ приложения ptla_ не подходит";
      return v.length === 48 ? null : `Полный ключ ptlc_ — 48 символов, а здесь ${v.length}. В списке ключей показан только идентификатор, полный ключ виден один раз при создании`;
    default:
      return v.length >= 4 ? null : "Слишком короткое значение";
  }
}

// Подсказка, по которой видно, что сохранено, без раскрытия секрета.
export function mapsSecretHint(name: MapsSecretName, value: string): string {
  const v = value.trim();
  if (name === "discordWebhook") {
    const m = /\/webhooks\/(\d+)\/.*(.{4})$/.exec(v);
    return m ? `…/webhooks/${m[1]}/…${m[2]}` : `…${v.slice(-4)}`;
  }
  if (name === "telegramToken") return `бот ${v.split(":")[0]}, …${v.slice(-4)}`;
  return `…${v.slice(-4)}`;
}

// ---------------------------------------------------------------- расписание

export type MapsRuleLike = Pick<
  MapsWipeRule,
  "key" | "weekday" | "time" | "serverIds" | "forceTimezone" | "forceTime" | "bpFirstOfMonth" | "bpEveryDays" | "bpAnchor" | "enabled"
> & { pool: unknown; template: unknown };

export interface Wipe<R extends MapsRuleLike = MapsRuleLike> {
  id: string; // например "thursday-2026-10-22"
  rule: R;
  wipeAt: Date;
}

const pad = (n: number) => String(n).padStart(2, "0");
export const isoDay = (d: CalendarDate) => `${d.year}-${pad(d.month)}-${pad(d.day)}`;
const utcDay = (d: Date): CalendarDate => ({ year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() });
const dayNumber = (d: CalendarDate) => Date.UTC(d.year, d.month - 1, d.day) / 86_400_000;

// Время вайпа в этот день. В первую неделю месяца у правила может быть своё время в другом поясе:
// форс-вайп в 14:00 по Нью-Йорку — это 21:00 МСК летом и 22:00 зимой.
export function wipeDatetime(rule: MapsRuleLike, day: CalendarDate, timezone: string): Date {
  if (rule.forceTimezone && rule.forceTime && day.day <= 7) {
    return zonedToDate(day, parseTime(rule.forceTime) ?? { hour: 0, minute: 0 }, rule.forceTimezone);
  }
  return zonedToDate(day, parseTime(rule.time) ?? { hour: 0, minute: 0 }, timezone);
}

// Вайпы, которые ещё не наступили, в ближайшие `days` дней, по возрастанию времени.
export function upcomingWipes<R extends MapsRuleLike>(rules: R[], timezone: string, now = new Date(), days = 8): Wipe<R>[] {
  const start = addDays(today(timezone, now), -1);
  const result: Wipe<R>[] = [];
  for (let i = 0; i < days + 2; i++) {
    const day = addDays(start, i);
    for (const rule of rules) {
      if (!rule.enabled || rule.weekday !== weekday(day)) continue;
      const at = wipeDatetime(rule, day, timezone);
      if (at > now) result.push({ id: `${rule.key}-${isoDay(day)}`, rule, wipeAt: at });
    }
  }
  return result.sort((a, b) => a.wipeAt.getTime() - b.wipeAt.getTime());
}

const localDay = (d: Date, timezone: string): CalendarDate => {
  const p = zonedParts(d, timezone);
  return { year: p.year, month: p.month, day: p.day };
};

// Staging-карты: вайп в первый четверг месяца и в следующую за ним пятницу (после обновления Rust).
export function isStagingWipe(wipeAt: Date, timezone: string): boolean {
  const day = localDay(wipeAt, timezone);
  const wd = weekday(day);
  if (wd === 3) return day.day <= 7;
  if (wd === 4) return addDays(day, -1).day <= 7;
  return false;
}

// Глобальный вайп: в Pterodactyl нужно включить «Wipe Blueprints».
export function isBlueprintWipe(rule: MapsRuleLike, wipeAt: Date, timezone: string): boolean {
  const day = localDay(wipeAt, timezone);
  if (rule.bpFirstOfMonth && day.day <= 7) return true;
  if (rule.bpEveryDays > 0 && rule.bpAnchor) {
    const diff = dayNumber(day) - dayNumber(utcDay(rule.bpAnchor));
    return ((diff % rule.bpEveryDays) + rule.bpEveryDays) % rule.bpEveryDays === 0;
  }
  return false;
}

// «чт 22.10 17:00 МСК»
export function fmtWipe(d: Date, timezone: string, label: string): string {
  const p = zonedParts(d, timezone);
  return `${WEEKDAYS_SHORT[p.weekday]} ${pad(p.day)}.${pad(p.month)} ${formatTime(p)} ${label}`;
}

// ---------------------------------------------------------------- шаблоны анонса

const TOKEN = /\{(view|download):(\d+)\}/g;

export type MapUrls = Record<number, { view: string | null; download: string | null }>;

// Подставляет ссылки карт в тело сообщения вебхука.
export function renderMapsTemplate(template: unknown, urls: MapUrls): unknown {
  const walk = (node: unknown): unknown => {
    if (typeof node === "string") {
      return node.replace(TOKEN, (_, kind: "view" | "download", id: string) => {
        const url = urls[Number(id)]?.[kind];
        if (!url) throw new Error(`В шаблоне есть сервер ${id}, а ссылки на его карту нет`);
        return url;
      });
    }
    if (Array.isArray(node)) return node.map(walk);
    if (node && typeof node === "object") return Object.fromEntries(Object.entries(node).map(([k, v]) => [k, walk(v)]));
    return node;
  };
  return walk(template);
}

export function templateServerIds(template: unknown): number[] {
  const ids = new Set<number>();
  for (const m of JSON.stringify(template ?? "").matchAll(TOKEN)) ids.add(Number(m[2]));
  return [...ids].sort((a, b) => a - b);
}

export function poolOf(rule: { pool: unknown }): Record<string, number> {
  const p = rule.pool;
  if (!p || typeof p !== "object" || Array.isArray(p)) return {};
  return Object.fromEntries(Object.entries(p).filter(([, v]) => typeof v === "number" && v > 0)) as Record<string, number>;
}

// Что не так с правилом: пул должен покрывать все серверы, лишних конфигов быть не должно,
// а шаблон — упоминать ровно серверы правила.
export function mapsRuleProblems(rule: MapsRuleLike, servers: Pick<MapsServer, "id" | "size" | "savedConfig">[]): string[] {
  const problems: string[] = [];
  const byId = new Map(servers.map((s) => [s.id, s]));
  const need = new Map<string, number>();
  const sizes = new Map<string, number>();
  for (const id of rule.serverIds) {
    const s = byId.get(id);
    if (!s) {
      problems.push(`Сервера #${id} нет в списке серверов`);
      continue;
    }
    need.set(s.savedConfig, (need.get(s.savedConfig) ?? 0) + 1);
    const size = sizes.get(s.savedConfig);
    if (size !== undefined && size !== s.size) problems.push(`Конфиг ${s.savedConfig} используется с разными размерами карты`);
    sizes.set(s.savedConfig, s.size);
  }
  const pool = poolOf(rule);
  for (const [config, n] of need) {
    if ((pool[config] ?? 0) < n) problems.push(`В пуле ${pool[config] ?? 0} карт ${config}, а серверов с этим конфигом ${n}`);
  }
  for (const config of Object.keys(pool)) if (!need.has(config)) problems.push(`В пуле конфиг ${config}, но серверов с ним в правиле нет`);
  const used = templateServerIds(rule.template).join(",");
  const want = [...rule.serverIds].sort((a, b) => a - b).join(",");
  if (used !== want) problems.push(`В шаблоне анонса серверы [${used}], а в правиле [${want}]`);
  return problems;
}

// ---------------------------------------------------------------- проверка полей

const httpsUrl = z
  .string()
  .trim()
  .max(300)
  .refine((v) => /^https?:\/\/[^\s/]+/.test(v), "Нужен адрес вида https://…")
  .transform((v) => v.replace(/\/+$/, ""));

const clock = z.string().transform((v, ctx) => {
  const t = parseTime(v);
  if (!t) {
    ctx.addIssue({ code: "custom", message: "Время — в формате ЧЧ:ММ" });
    return z.NEVER;
  }
  return formatTime(t);
});

export const mapsSettingsSchema = z
  .object({
    timezone: z.string().trim().refine(isValidTimeZone, "Неизвестный часовой пояс, пример: Europe/Moscow"),
    timezoneLabel: z.string().trim().min(1).max(20),
    sendLeadHours: z.number().min(0).max(168),
    genLeadHours: z.number().min(0).max(168),
    autoPick: z.boolean(),
    panelAskHours: z.number().int().min(1).max(72),
    panelRemindMinutes: z.number().int().min(10).max(1440),
    panelAutoMinutes: z.number().int().min(5).max(600),
    telegramAdminIds: z.array(z.string().regex(/^\d{1,15}$/, "Telegram ID — только цифры")).max(20),
    telegramChatId: z.string().regex(/^-?\d{1,20}$/, "ID чата Telegram — число, у групп со знаком минус").nullable(),
    rustmapsOrgId: z.string().trim().max(100).nullable(),
    s3Endpoint: z.union([httpsUrl, z.literal("")]),
    s3Region: z.string().trim().max(50),
    s3Bucket: z.string().trim().max(63).regex(/^[a-z0-9.-]*$/, "Имя бакета — строчные латинские буквы, цифры, точки и дефисы"),
    s3Prefix: z
      .string()
      .trim()
      .max(100)
      .regex(/^[\w./-]*$/, "Префикс — латинские буквы, цифры, точки, дефисы и /")
      .transform((v) => v.replace(/^\/+|\/+$/g, "")),
    s3Addressing: z.enum(["path", "virtual"]),
    cdnBaseUrl: z.union([httpsUrl, z.literal("")]),
    pteroUrl: httpsUrl.nullable(),
  })
  .refine((s) => s.panelAutoMinutes < s.panelAskHours * 60, {
    message: "Запись ссылок «сама» должна быть позже, чем первый вопрос",
    path: ["panelAutoMinutes"],
  });

export const mapsServerSchema = z.object({
  id: z.number().int().min(1, "Номер сервера — от 1").max(99),
  title: z.string().trim().min(1, "Укажи название").max(60),
  folder: z.string().trim().regex(/^[\w.-]{1,60}$/, "Папка — латинские буквы, цифры, точки, дефисы и подчёркивания"),
  size: z.number().int().min(1000, "Размер карты — от 1000").max(6000, "Размер карты — до 6000"),
  savedConfig: z.string().trim().min(1, "Укажи имя сохранённой конфигурации RustMaps").max(60),
  pteroUuid: z
    .string()
    .trim()
    .regex(/^[a-z0-9-]{8,36}$/i, "Идентификатор сервера Pterodactyl — из адреса /server/<id>")
    .nullable(),
});

export const mapsRuleSchema = z
  .object({
    key: z.string().trim().regex(/^[a-z0-9_-]{1,20}$/, "Ключ правила — латиница в нижнем регистре, цифры, - и _ (до 20 символов)"),
    weekday: z.number().int().min(0).max(6),
    time: clock,
    serverIds: z.array(z.number().int().min(1).max(99)).min(1, "Выбери хотя бы один сервер"),
    pool: z.record(z.string().min(1).max(60), z.number().int().min(1, "В пуле — от 1 карты").max(7, "RustMaps генерирует не больше 7 карт одновременно")),
    template: z
      .record(z.string(), z.unknown())
      .refine((t) => "content" in t || "embeds" in t, "В шаблоне нужен content или embeds — это тело сообщения вебхука Discord")
      .refine((t) => JSON.stringify(t).length <= 6000, "Шаблон слишком большой для сообщения Discord"),
    forceTimezone: z.string().trim().refine(isValidTimeZone, "Неизвестный часовой пояс").nullable(),
    forceTime: clock.nullable(),
    bpFirstOfMonth: z.boolean(),
    bpEveryDays: z.number().int().min(0).max(365),
    bpAnchor: z.date().nullable(),
    enabled: z.boolean(),
  })
  .refine((r) => !r.forceTimezone === !r.forceTime, { message: "Для форс-вайпа нужны и пояс, и время", path: ["forceTime"] })
  .refine((r) => r.bpEveryDays === 0 || r.bpAnchor !== null, {
    message: "Для глобального вайпа раз в N дней укажи дату последнего глобального вайпа",
    path: ["bpAnchor"],
  });

// ---------------------------------------------------------------- стартовые данные (как в прежнем боте)

const announce = (servers: [number, string][], footer?: string) => ({
  embeds: [
    {
      title: "🗺️ КАРТЫ НА СЛЕДУЮЩИЙ ВАЙП",
      description: servers.map(([id, title]) => `**${title}:** [Посмотреть]({view:${id}}) | [Скачать]({download:${id}})`).join("\n\n"),
      color: 16372510,
      ...(footer ? { footer: { text: footer } } : {}),
    },
  ],
});

export const DEFAULT_MAPS_SERVERS = [
  { id: 1, folder: "1_nolimit", title: "FR #1 [NOLIMIT | X3]", size: 4000, savedConfig: "4000_Modded" },
  { id: 2, folder: "2_max3", title: "FR #2 [MAX 3 | X3]", size: 4000, savedConfig: "4000_Modded" },
  { id: 3, folder: "3_max2", title: "FR #3 [MAX 2 | X3]", size: 3500, savedConfig: "3500_Modded" },
  { id: 4, folder: "4_solo", title: "FR #4 [SOLO | X3]", size: 3500, savedConfig: "3500_Modded" },
  { id: 5, folder: "5_main", title: "FR #5 [MAIN]", size: 4250, savedConfig: "4250_Main" },
];

const title = (id: number) => DEFAULT_MAPS_SERVERS.find((s) => s.id === id)!.title;

export const DEFAULT_MAPS_RULES: Prisma.MapsWipeRuleCreateInput[] = [
  {
    key: "tuesday",
    weekday: 1,
    time: "14:00",
    serverIds: [1, 2, 3],
    pool: { "4000_Modded": 3, "3500_Modded": 4 },
    template: announce([1, 2, 3].map((id) => [id, title(id)]), "Вайп произойдёт во вторник в 14:00 по МСК"),
  },
  {
    key: "thursday",
    weekday: 3,
    time: "17:00",
    serverIds: [5],
    pool: { "4250_Main": 7 },
    template: announce([[5, title(5)]]),
    forceTimezone: "America/New_York",
    forceTime: "14:00",
    bpFirstOfMonth: true,
  },
  {
    key: "friday",
    weekday: 4,
    time: "14:00",
    serverIds: [1, 2, 3, 4],
    pool: { "4000_Modded": 3, "3500_Modded": 4 },
    template: announce([1, 2, 3, 4].map((id) => [id, title(id)])),
    // Последний глобальный пятничный вайп: 2 октября 2026, дальше раз в две недели.
    bpEveryDays: 14,
    bpAnchor: new Date(Date.UTC(2026, 9, 2)),
  },
];

export async function getMapsSettings(db: Db) {
  return db.mapsSettings.upsert({ where: { id: 1 }, update: {}, create: { id: 1 } });
}

// Серверы и правила как в прежнем боте, если их ещё нет. Дальше они меняются в панели.
export async function ensureMapsDefaults(db: Db): Promise<void> {
  await getMapsSettings(db);
  if ((await db.mapsServer.count()) === 0) await db.mapsServer.createMany({ data: DEFAULT_MAPS_SERVERS, skipDuplicates: true });
  if ((await db.mapsWipeRule.count()) === 0) {
    for (const data of DEFAULT_MAPS_RULES) await db.mapsWipeRule.upsert({ where: { key: data.key }, create: data, update: {} });
  }
}
