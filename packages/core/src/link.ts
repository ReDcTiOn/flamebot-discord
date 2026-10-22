import { createHash, randomBytes, randomInt } from "node:crypto";
import { z } from "zod";
import type { LinkSettings } from "@prisma/client";
import type { Db } from "./db.js";
import { snowflake } from "./settings.js";

// Общие правила модуля «Привязка Steam»: коды из игры, ключи API серверов, проверка настроек.
// Всё здесь без Discord, чтобы панель и бот считали одинаково.

// Без похожих друг на друга символов (0/O, 1/I/L): код переписывают из игры руками.
export const LINK_CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
export const LINK_CODE_LENGTH = 6;

export function generateLinkCode(): string {
  let code = "";
  for (let i = 0; i < LINK_CODE_LENGTH; i++) code += LINK_CODE_ALPHABET[randomInt(LINK_CODE_ALPHABET.length)];
  return code;
}

// Код как его ввёл игрок: регистр, пробелы и дефисы не важны. null — точно не код.
export function normalizeLinkCode(input: string): string | null {
  const code = input.toUpperCase().replace(/[\s\-_.]/g, "");
  if (code.length !== LINK_CODE_LENGTH) return null;
  for (const ch of code) if (!LINK_CODE_ALPHABET.includes(ch)) return null;
  return code;
}

// SteamID64 обычного аккаунта.
export const STEAM_ID = /^7656119\d{10}$/;

export function steamProfileUrl(steamId: string): string {
  return `https://steamcommunity.com/profiles/${steamId}`;
}

// Ник из игры: без управляющих символов и разметки Discord, не длиннее 64 символов.
export function cleanSteamName(name: string): string {
  const clean = name
    .replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e\u2066-\u2069]/g, "")
    .replace(/<[^>]*>/g, "")
    .trim()
    .slice(0, 64);
  return clean || "Без имени";
}

// Ключ API сервера: префикс, чтобы ключ узнавался в конфиге, и 32 случайных байта.
export const LINK_KEY_PREFIX = "flk_";

export function generateLinkKey(): string {
  return LINK_KEY_PREFIX + randomBytes(32).toString("base64url");
}

export function hashLinkKey(key: string): string {
  return createHash("sha256").update(key.trim()).digest("hex");
}

export function linkKeyHint(key: string): string {
  return `${key.slice(0, LINK_KEY_PREFIX.length + 4)}…`;
}

export const LINK_TTL_MIN = 2;
export const LINK_TTL_MAX = 60;

export const linkSettingsSchema = z.object({
  channelId: snowflake.nullable(),
  roleId: snowflake.nullable(),
  codeTtlMinutes: z
    .number()
    .int()
    .min(LINK_TTL_MIN, `Код действует от ${LINK_TTL_MIN} минут`)
    .max(LINK_TTL_MAX, `Код действует не дольше ${LINK_TTL_MAX} минут`),
  panelTitle: z.string().trim().min(1, "Укажи заголовок сообщения").max(200, "Заголовок — не больше 200 символов"),
  // Описание встраивания в Discord — до 4096 символов, оставляем запас.
  panelText: z.string().trim().min(1, "Укажи текст сообщения").max(3500, "Текст — не больше 3500 символов"),
  // Подпись кнопки в Discord — до 80 символов.
  buttonLabel: z.string().trim().min(1, "Укажи подпись кнопки").max(80, "Подпись кнопки — не больше 80 символов"),
});

export async function getLinkSettings(db: Db): Promise<LinkSettings> {
  return db.linkSettings.upsert({ where: { id: 1 }, update: {}, create: { id: 1 } });
}
