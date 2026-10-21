import { isIP } from "node:net";
import { z } from "zod";

// Общие правила модуля «Онлайн серверов»: проверка полей в панели и в боте.

const HOSTNAME = /^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)*$/i;

export const onlineHost = z
  .string()
  .trim()
  .min(1, "Укажи IP или адрес сервера")
  .max(253)
  .refine((v) => isIP(v) !== 0 || HOSTNAME.test(v), "Неверный IP или адрес сервера");

export const onlineServerSchema = z.object({
  name: z.string().trim().min(1, "Укажи название").max(60),
  host: onlineHost,
  port: z.number().int().min(1).max(65535),
  enabled: z.boolean(),
  sortOrder: z.number().int().min(-1000).max(1000),
});

// Токен бота Discord: три части через точку.
export const discordTokenSchema = z
  .string()
  .trim()
  .regex(/^[\w-]{20,}\.[\w-]{4,}\.[\w-]{20,}$/, "Это не похоже на токен бота Discord");

export const rconPasswordSchema = z.string().min(1, "Пароль RCON пустой").max(128, "Слишком длинный пароль RCON");

const statusText = z.string().trim().min(1).max(128);

export const onlineSettingsSchema = z.object({
  pollIntervalMs: z.number().int().min(2000).max(300_000),
  connectTimeoutMs: z.number().int().min(3000).max(120_000),
  responseTimeoutMs: z.number().int().min(10_000).max(600_000),
  offlineText: statusText,
  startingText: statusText,
  onlineText: statusText,
  queueText: statusText,
});

export function onlineStatusText(template: string, info: { players: number; max: number; queued: number }): string {
  return template
    .replaceAll("{players}", String(info.players))
    .replaceAll("{max}", String(info.max))
    .replaceAll("{queued}", String(info.queued))
    .slice(0, 128);
}

// ---------- Уведомления в Telegram ----------

export const ONLINE_TELEGRAM_TOKEN_CONTEXT = "online:telegram:token";

export const telegramTokenSchema = z
  .string()
  .trim()
  .regex(/^\d{5,15}:[\w-]{30,}$/, "Это не похоже на токен Telegram: 123456789:AA… от @BotFather");

// По токену видно, какой это бот, но не сам секрет: «бот 123456789, …AbCd».
export function telegramTokenHint(token: string): string {
  return `бот ${token.split(":")[0]}, …${token.slice(-4)}`;
}

// ID пользователя, группы (с минусом) или @username публичного канала.
const telegramChat = z
  .string()
  .regex(/^(-?\d{1,20}|@[A-Za-z][\w]{4,31})$/, "Чат Telegram — число (у групп с минусом) или @username канала");

const notifyText = z.string().trim().min(1, "Текст уведомления пустой").max(1000);

export const onlineTelegramSchema = z.object({
  chatIds: z.array(telegramChat).max(20, "Не больше 20 получателей"),
  notifyOffline: z.boolean(),
  notifyOnline: z.boolean(),
  delaySec: z.number().int().min(0).max(3600),
  offlineText: notifyText,
  onlineText: notifyText,
});

// Список чатов из поля панели: через запятую, пробел или с новой строки, без повторов.
export function parseTelegramChats(text: string): string[] {
  return [...new Set(text.split(/[\s,;]+/).filter(Boolean))];
}

// «45 с», «12 мин», «2 ч 5 мин», «3 д 4 ч».
export function formatDowntime(ms: number): string {
  const sec = Math.max(0, Math.round(ms / 1000));
  if (sec < 60) return `${sec} с`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min} мин`;
  const h = Math.floor(min / 60);
  if (h < 24) return min % 60 ? `${h} ч ${min % 60} мин` : `${h} ч`;
  const d = Math.floor(h / 24);
  return h % 24 ? `${d} д ${h % 24} ч` : `${d} д`;
}

export function onlineTelegramText(
  template: string,
  vars: { server: string; downtime?: string; players?: number; max?: number },
): string {
  return template
    .replaceAll("{server}", vars.server)
    .replaceAll("{downtime}", vars.downtime ?? "")
    .replaceAll("{players}", vars.players === undefined ? "" : String(vars.players))
    .replaceAll("{max}", vars.max === undefined ? "" : String(vars.max))
    .slice(0, 4000);
}

// Внутренние и служебные адреса. Бот не подключается к ним, чтобы через панель
// нельзя было заставить его стучаться внутрь сети, где стоят база и панель.
export function isPrivateAddress(ip: string): boolean {
  const v = isIP(ip);
  if (v === 4) {
    const [a, b] = ip.split(".").map(Number) as [number, number];
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      a >= 224
    );
  }
  if (v === 6) {
    const x = ip.toLowerCase();
    if (x.startsWith("::ffff:")) return isPrivateAddress(x.slice(7));
    return x === "::" || x === "::1" || x.startsWith("fc") || x.startsWith("fd") || x.startsWith("fe80");
  }
  return true;
}
