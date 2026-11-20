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
  // Сводные сообщения, когда серверов несколько (массовый рестарт).
  groupOfflineText: notifyText,
  groupOnlineText: notifyText,
  groupOnlineLine: notifyText,
  groupWaitingText: notifyText,
});

// Список чатов из поля панели: через запятую, пробел или с новой строки, без повторов.
export function parseTelegramChats(text: string): string[] {
  return [...new Set(text.split(/[\s,;]+/).filter(Boolean))];
}

// «45 с», «3 мин 12 с», «12 мин», «2 ч 5 мин», «3 д 4 ч». Секунды — только у коротких простоев, как у рестарта.
export function formatDowntime(ms: number): string {
  const sec = Math.max(0, Math.round(ms / 1000));
  if (sec < 60) return `${sec} с`;
  const min = Math.floor(sec / 60);
  if (min < 10 && sec % 60) return `${min} мин ${sec % 60} с`;
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

// ---------- Сводные уведомления ----------

// «4 сервера», «5 серверов», «21 сервер».
export function serversCount(n: number): string {
  const n100 = n % 100;
  const n10 = n % 10;
  const word = n100 >= 11 && n100 <= 19 ? "серверов" : n10 === 1 ? "сервер" : n10 >= 2 && n10 <= 4 ? "сервера" : "серверов";
  return `${n} ${word}`;
}

export interface OnlineAlertTexts {
  offlineText: string;
  onlineText: string;
  groupOfflineText: string;
  groupOnlineText: string;
  groupOnlineLine: string;
  groupWaitingText: string;
}

export interface OnlineUpItem {
  server: string;
  downtime: string;
  players: number;
  max: number;
}

// Сообщение о выключении: один сервер — строкой, несколько — заголовком и списком.
export function onlineDownMessage(t: OnlineAlertTexts, servers: string[]): string {
  if (servers.length === 1) return onlineTelegramText(t.offlineText, { server: servers[0]! });
  const title = t.groupOfflineText.replaceAll("{count}", serversCount(servers.length));
  return [title, ...servers.map((s) => `• ${s}`)].join("\n").slice(0, 4000);
}

// Сообщение о включении. waiting — серверы того же рестарта, которые ещё не поднялись.
export function onlineUpMessage(t: OnlineAlertTexts, items: OnlineUpItem[], waiting: string[]): string {
  if (items.length === 1 && waiting.length === 0) return onlineTelegramText(t.onlineText, items[0]!);
  const title = t.groupOnlineText.replaceAll("{count}", serversCount(items.length));
  const lines = items.map((i) => onlineTelegramText(t.groupOnlineLine, i));
  const tail = waiting.length ? ["", t.groupWaitingText.replaceAll("{servers}", waiting.join(", "))] : [];
  return [title, ...lines, ...tail].join("\n").slice(0, 4000);
}

// Сколько ждать остальных: упавшие почти одновременно попадают в одно сообщение,
// включения ждут остальных серверов того же рестарта, но не дольше 2 минут.
export const ONLINE_GATHER_DOWN_MS = 15_000;
export const ONLINE_GATHER_UP_MIN_MS = 5_000;
export const ONLINE_GATHER_UP_MAX_MS = 120_000;

export type AlertState = "ONLINE" | "STARTING" | "OFFLINE" | "DISABLED";

export interface AlertServer {
  id: number;
  // Что видит бот сейчас.
  online: boolean;
  offlineSince: number;
  // Что уже известно получателям (хранится в базе).
  alertState: AlertState | null;
  downSince: number | null;
  // Когда отправили «выключился». Серверы одного сообщения — один рестарт.
  downNotifiedAt: number | null;
}

export interface AlertMemory {
  // Когда сервер стал «выключенным» для уведомлений: от этого момента ждём остальных.
  downAt: Map<number, number>;
  // Когда увидели, что сервер снова работает.
  upAt: Map<number, number>;
}

export interface AlertPlan {
  updates: Map<number, { alertState: AlertState; downSince: number | null; downNotifiedAt: number | null }>;
  down: number[];
  up: number[];
  waiting: number[];
}

// Решает, что и когда сообщать. Чистая функция: бот подставляет состояние серверов и память,
// записывает updates в базу и отправляет сообщения о down и up.
export function planOnlineAlerts(servers: AlertServer[], memory: AlertMemory, now: number, delayMs: number): AlertPlan {
  const updates: AlertPlan["updates"] = new Map();
  const cur = (s: AlertServer) => ({ alertState: s.alertState, downSince: s.downSince, downNotifiedAt: s.downNotifiedAt, ...updates.get(s.id) });

  for (const s of servers) {
    if (s.online) {
      memory.downAt.delete(s.id);
      if (s.alertState === "ONLINE") {
        memory.upAt.delete(s.id);
      } else if (s.alertState === "OFFLINE" && s.downSince !== null) {
        if (!memory.upAt.has(s.id)) memory.upAt.set(s.id, now);
      } else {
        // Ни разу не видели работающим: просто запоминаем, что работает.
        updates.set(s.id, { alertState: "ONLINE", downSince: null, downNotifiedAt: null });
      }
      continue;
    }
    memory.upAt.delete(s.id);
    if (s.alertState === "OFFLINE") continue;
    // Короткий обрыв не тревога: ждём, вдруг сервер сейчас же поднимется.
    if (now - s.offlineSince < delayMs) continue;
    if (s.alertState === "ONLINE") {
      updates.set(s.id, { alertState: "OFFLINE", downSince: s.offlineSince, downNotifiedAt: null });
      memory.downAt.set(s.id, now);
    } else {
      // Новый сервер или бот только что запущен: о выключении сообщать нечего.
      updates.set(s.id, { alertState: "OFFLINE", downSince: null, downNotifiedAt: null });
    }
  }

  // «Выключились»: ждём остальных 15 секунд от первого.
  const down: number[] = [];
  const pendingDown = servers.filter((s) => {
    const c = cur(s);
    return !s.online && c.alertState === "OFFLINE" && c.downSince !== null && c.downNotifiedAt === null;
  });
  if (pendingDown.length) {
    for (const s of pendingDown) if (!memory.downAt.has(s.id)) memory.downAt.set(s.id, now);
    const first = Math.min(...pendingDown.map((s) => memory.downAt.get(s.id)!));
    if (now - first >= ONLINE_GATHER_DOWN_MS) {
      for (const s of pendingDown) {
        const c = cur(s);
        updates.set(s.id, { alertState: "OFFLINE", downSince: c.downSince, downNotifiedAt: now });
        memory.downAt.delete(s.id);
        down.push(s.id);
      }
    }
  }

  // «Снова работают»: ждём остальных из того же рестарта, но не дольше 2 минут.
  const up: number[] = [];
  const waiting: number[] = [];
  const candidates = servers.filter((s) => s.online && memory.upAt.has(s.id));
  if (candidates.length) {
    const waves = new Set(candidates.map((s) => cur(s).downNotifiedAt).filter((t): t is number => t !== null));
    const stillDown = servers.filter((s) => {
      const c = cur(s);
      return !s.online && c.alertState === "OFFLINE" && c.downNotifiedAt !== null && waves.has(c.downNotifiedAt);
    });
    const waited = now - Math.min(...candidates.map((s) => memory.upAt.get(s.id)!));
    if ((stillDown.length === 0 && waited >= ONLINE_GATHER_UP_MIN_MS) || waited >= ONLINE_GATHER_UP_MAX_MS) {
      for (const s of candidates) {
        updates.set(s.id, { alertState: "ONLINE", downSince: null, downNotifiedAt: null });
        memory.upAt.delete(s.id);
        up.push(s.id);
      }
      waiting.push(...stillDown.map((s) => s.id));
    }
  }

  return { updates, down, up, waiting };
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
