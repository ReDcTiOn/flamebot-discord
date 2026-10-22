import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { KeyObject } from "node:crypto";
import type { Db } from "./db.js";
import { generateSecretKeyPair, loadPrivateKey, openSecret, sealSecret } from "./secrets.js";

// Подключение ботов к Discord без .env: токен вводится в панели, панель шифрует его открытым
// ключом бота, а расшифровывает только сам бот своим приватным ключом.
// Приватный ключ лежит в томе бота (BOT_DATA_DIR), в базу он не попадает: украденная база
// или взломанная панель не дают прочитать ни одного токена.

// Боты, токен которых вводится в панели (раздел «Подключение»).
export const CONNECTABLE_BOTS = ["link", "rating", "giveaway"] as const;
export type ConnectableBot = (typeof CONNECTABLE_BOTS)[number];

export const tokenContext = (botKey: string) => `bot:${botKey}:discordToken`;

export function botDataDir(): string {
  return process.env.BOT_DATA_DIR?.trim() || join(process.cwd(), ".data");
}

export interface BotKey {
  key: KeyObject;
  publicKey: string;
  // env — из переменной окружения, file — из тома бота, generated — создан сейчас.
  source: "env" | "file" | "generated";
}

function readKeyFile(file: string): string | null {
  try {
    return readFileSync(file, "utf8").trim() || null;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }
}

// Записывает ключ, только если файла ещё нет (флаг wx): два процесса не затрут ключ друг друга.
function writeKeyFile(file: string, value: string): boolean {
  mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
  try {
    writeFileSync(file, `${value}\n`, { mode: 0o600, flag: "wx" });
    return true;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "EEXIST") return false;
    throw err;
  }
}

// Ключ из переменной окружения (как было раньше) копируется в том, чтобы переменную можно
// было удалить из .env. Если нет ни переменной, ни файла — бот создаёт себе новый ключ.
export function loadOrCreateBotKey(file: string, envValue?: string): BotKey {
  const env = envValue?.trim();
  if (env) {
    const loaded = loadPrivateKey(env);
    if (readKeyFile(file) === null) writeKeyFile(file, env);
    return { ...loaded, source: "env" };
  }
  const existing = readKeyFile(file);
  if (existing) return { ...loadPrivateKey(existing), source: "file" };

  const { privateKey } = generateSecretKeyPair();
  if (!writeKeyFile(file, privateKey)) {
    // Файл успел создать другой процесс — берём его ключ.
    return { ...loadPrivateKey(readKeyFile(file)!), source: "file" };
  }
  return { ...loadPrivateKey(privateKey), source: "generated" };
}

export async function publishBotKey(db: Db, botKey: string, publicKey: string): Promise<void> {
  await db.botPublicKey.upsert({ where: { botKey }, create: { botKey, publicKey }, update: { publicKey } });
}

// Метка версии токена: бот сверяет её раз в несколько секунд и переподключается, если в панели
// задали новый токен. Сам токен при этом не читается.
export async function botTokenVersion(db: Db, botKey: string): Promise<string> {
  const row = await db.botCredential.findUnique({ where: { botKey }, select: { tokenSetAt: true, discordTokenEnc: true } });
  if (!row?.discordTokenEnc) return "none";
  return row.tokenSetAt?.toISOString() ?? "set";
}

export type BotTokenResult =
  | { token: string; source: "panel" | "env-migrated" }
  | { token: null; error: string };

// Токен из панели. Если токен ещё ни разу не задавали, а в .env остался старый, бот один раз
// переносит его в базу зашифрованным: дальше токен меняется только в панели, строку из .env можно удалить.
// Токен, удалённый в панели, из .env обратно не подхватывается.
export async function loadBotToken(db: Db, botKey: string, key: BotKey, envToken?: string): Promise<BotTokenResult> {
  const row = await db.botCredential.findUnique({ where: { botKey } });
  if (row?.discordTokenEnc) {
    try {
      return { token: openSecret(key.key, row.discordTokenEnc, tokenContext(botKey)), source: "panel" };
    } catch {
      return { token: null, error: "Токен зашифрован другим ключом бота. Задай токен в панели заново." };
    }
  }
  const env = envToken?.trim();
  if (!row && env) {
    await db.botCredential.upsert({
      where: { botKey },
      create: { botKey, discordTokenEnc: sealSecret(key.publicKey, env, tokenContext(botKey)), tokenSetAt: new Date(), tokenSetByName: "перенесён из .env" },
      update: { discordTokenEnc: sealSecret(key.publicKey, env, tokenContext(botKey)), tokenSetAt: new Date(), tokenSetById: null, tokenSetByName: "перенесён из .env" },
    });
    return { token: env, source: "env-migrated" };
  }
  return { token: null, error: "Токен бота не задан. Укажи его в панели, раздел «Подключение»." };
}

export interface BotIdentity {
  id: string;
  tag: string;
  avatar: string | null;
}

// Бот пишет, под каким аккаунтом вошёл, или понятную причину, почему не смог.
export async function reportBotIdentity(db: Db, botKey: string, identity: BotIdentity | null, loginError: string | null): Promise<void> {
  const data = {
    discordUserId: identity?.id ?? null,
    discordUserTag: identity?.tag ?? null,
    discordAvatar: identity?.avatar ?? null,
    loginError: loginError ? loginError.slice(0, 300) : null,
  };
  await db.botStatus.upsert({
    where: { botKey },
    create: { botKey, heartbeatAt: new Date(), state: identity ? "running" : "failed", ...data },
    update: data,
  });
}

// Понятное объяснение ошибки входа. Сообщения discord.js токен не содержат.
export function describeLoginError(err: unknown): string {
  const e = err as { code?: string | number; message?: string };
  if (e?.code === "TokenInvalid") return "Discord не принял токен. Проверь его или создай новый (Developer Portal → Bot → Reset Token).";
  if (e?.code === 4014 || /disallowed intent/i.test(e?.message ?? "")) {
    return "Discord не разрешил привилегированные интенты: включи их в Developer Portal → Bot → Privileged Gateway Intents.";
  }
  if (e?.code === 4004) return "Discord отклонил вход: токен недействителен.";
  return `Не удалось войти в Discord: ${(e?.message ?? String(err)).slice(0, 200)}`;
}
