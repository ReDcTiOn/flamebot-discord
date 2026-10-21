import {
  NOTICE_SECRET_NAMES,
  getNoticeSettings,
  noticeSecretContext,
  openSecret,
  prisma,
  type BotKey,
  type NoticeKind,
  type NoticeReminder,
  type NoticeRule,
  type NoticeSecretName,
  type NoticeSettings,
  type NoticeTemplate,
} from "@flamebot/core";
import { Telegram } from "@flamebot/core/telegram";
import type { Image } from "./clients/discord.js";
import type { GameStores } from "./clients/gamestores.js";
import { log } from "./events.js";

// Куда отправлять: боевые или тестовые площадки. null — площадка не настроена.
export interface Targets {
  discord: string | null;
  vkToken: string | null;
  vkGroupId: number | null;
  vkPhotos: Partial<Record<NoticeKind, string>>;
}

// Всё, что бот берёт из панели. Пересобирается, когда в панели что-то меняют, — без перезапуска бота.
export interface NoticeContext {
  settings: NoticeSettings;
  rules: NoticeRule[];
  templates: Map<string, NoticeTemplate>;
  images: Partial<Record<NoticeKind, Image>>;
  agenda: Map<number, string[]>;
  reminders: NoticeReminder[];
  telegram: Telegram | null;
  adminIds: string[];
  live: Targets;
  test: Targets;
  gamestores: GameStores | null;
  // Чего не хватает для работы: показывается в панели и при запуске.
  missing: string[];
  signature: string;
}

let current: NoticeContext | null = null;
let secretsCache: { version: string; values: Partial<Record<NoticeSecretName, string>> } | null = null;
let imagesCache: { version: string; images: Partial<Record<NoticeKind, Image>> } | null = null;

async function loadSecrets(key: BotKey) {
  const rows = await prisma.noticeSecret.findMany();
  const version = rows.map((r) => `${r.name}:${r.setAt.getTime()}`).sort().join("|");
  if (secretsCache?.version === version) return secretsCache;
  const values: Partial<Record<NoticeSecretName, string>> = {};
  const broken: string[] = [];
  for (const row of rows) {
    if (!(NOTICE_SECRET_NAMES as string[]).includes(row.name)) continue;
    const name = row.name as NoticeSecretName;
    try {
      values[name] = openSecret(key.key, row.valueEnc, noticeSecretContext(name));
    } catch {
      broken.push(name);
    }
  }
  if (broken.length) log.warn(`Не расшифровываются секреты: ${broken.join(", ")}. Их нужно ввести в панели заново.`);
  secretsCache = { version, values };
  return secretsCache;
}

// Картинки весят мегабайты: перечитываем их, только когда их заменили в панели.
async function loadImages() {
  const meta = await prisma.noticeImage.findMany({ select: { kind: true, updatedAt: true } });
  const version = meta.map((m) => `${m.kind}:${m.updatedAt.getTime()}`).sort().join("|");
  if (imagesCache?.version === version) return imagesCache;
  const rows = await prisma.noticeImage.findMany();
  const images: Partial<Record<NoticeKind, Image>> = {};
  for (const r of rows) if (r.kind === "regular" || r.kind === "global") images[r.kind] = { data: Buffer.from(r.data), mime: r.mime };
  imagesCache = { version, images };
  return imagesCache;
}

const photos = (regular: string | null, global: string | null) => ({ ...(regular ? { regular } : {}), ...(global ? { global } : {}) });

export async function loadContext(key: BotKey): Promise<NoticeContext> {
  const [settings, rules, templates, days, reminders, secrets, images] = await Promise.all([
    getNoticeSettings(prisma),
    prisma.noticeRule.findMany({ orderBy: [{ weekday: "asc" }, { time: "asc" }] }),
    prisma.noticeTemplate.findMany({ orderBy: [{ sortOrder: "asc" }, { id: "asc" }] }),
    prisma.noticeAgendaDay.findMany(),
    prisma.noticeReminder.findMany({ orderBy: [{ sortOrder: "asc" }, { id: "asc" }] }),
    loadSecrets(key),
    loadImages(),
  ]);
  const signature = JSON.stringify([
    settings.updatedAt.getTime(),
    rules.map((r) => r.updatedAt.getTime()),
    templates.map((t) => t.updatedAt.getTime()),
    days.map((d) => [d.weekday, d.items]),
    reminders.map((r) => r.updatedAt.getTime()),
    secrets.version,
    images.version,
  ]);
  if (current?.signature === signature) return current;

  const s = secrets.values;
  const missing: string[] = [];
  if (!s.telegramToken) missing.push("токен Telegram");
  if (!settings.telegramAdminIds.length) missing.push("Telegram ID админов");
  if (!s.discordWebhook) missing.push("вебхук Discord");
  if (!s.vkToken || !settings.vkGroupId) missing.push("ключ и ID сообщества ВКонтакте");
  else for (const k of ["regular", "global"] as const) if (!(k === "regular" ? settings.vkPhotoRegular : settings.vkPhotoGlobal)) missing.push(`фото ВКонтакте (${k === "regular" ? "обычный" : "глобальный"})`);
  if (!s.gamestoresSecretKey || !settings.gamestoresStoreId) missing.push("ключи gamestores");
  for (const k of ["regular", "global"] as const) if (!images.images[k]) missing.push(`картинка поста (${k === "regular" ? "обычный" : "глобальный"})`);
  if (!templates.length) missing.push("тексты объявлений");

  current = {
    settings,
    rules,
    templates: new Map(templates.map((t) => [t.id, t])),
    images: images.images,
    agenda: new Map(days.filter((d) => d.items.length).map((d) => [d.weekday, d.items])),
    reminders: reminders.filter((r) => r.enabled),
    telegram: s.telegramToken ? new Telegram(s.telegramToken) : null,
    adminIds: settings.telegramAdminIds,
    live: { discord: s.discordWebhook ?? null, vkToken: s.vkToken ?? null, vkGroupId: settings.vkGroupId, vkPhotos: photos(settings.vkPhotoRegular, settings.vkPhotoGlobal) },
    test: {
      discord: s.testDiscordWebhook ?? null,
      vkToken: s.testVkToken ?? null,
      vkGroupId: settings.testVkGroupId,
      vkPhotos: photos(settings.testVkPhotoRegular, settings.testVkPhotoGlobal),
    },
    gamestores: s.gamestoresSecretKey && settings.gamestoresStoreId ? { storeId: settings.gamestoresStoreId, secretKey: s.gamestoresSecretKey } : null,
    missing,
    signature,
  };
  return current;
}

export function ctx(): NoticeContext {
  if (!current) throw new Error("Настройки бота ещё не загружены");
  return current;
}
