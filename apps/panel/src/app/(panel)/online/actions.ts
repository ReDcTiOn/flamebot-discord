"use server";

import { revalidatePath } from "next/cache";
import {
  ONLINE_TELEGRAM_TOKEN_CONTEXT,
  discordTokenSchema,
  onlineServerSchema,
  onlineSettingsSchema,
  onlineTelegramSchema,
  parseTelegramChats,
  prisma,
  rconPasswordSchema,
  sealSecret,
  secretContext,
  telegramTokenHint,
  telegramTokenSchema,
} from "@flamebot/core";
import { ActionError, audit, runAction, type ActionResult } from "@/lib/auth";
import { bool, idParam, int, intOrNull, str } from "@/lib/form";
import { telegramBotTakenBy } from "@/lib/telegramBots";

const MODULE = "online";

// Открытый ключ публикует сам бот онлайна. Приватного ключа у панели нет,
// поэтому сохранённые секреты она прочитать не может.
async function botPublicKey(): Promise<string> {
  const row = await prisma.botPublicKey.findUnique({ where: { botKey: "online" } });
  if (!row) throw new ActionError("Бот онлайна ещё ни разу не запускался: запусти его, чтобы панель получила ключ шифрования");
  return row.publicKey;
}

function parseServer(fd: FormData) {
  return onlineServerSchema.parse({
    name: str(fd, "name"),
    host: str(fd, "host"),
    port: int(fd, "port"),
    enabled: bool(fd, "enabled"),
    sortOrder: intOrNull(fd, "sortOrder") ?? 0,
  });
}

// Секрет приходит, только если его ввели заново. Пустое поле — оставить прежний.
function readSecrets(fd: FormData) {
  const rcon = fd.get("rconPassword");
  const token = fd.get("discordToken");
  return {
    rconPassword: typeof rcon === "string" && rcon !== "" ? rconPasswordSchema.parse(rcon) : null,
    discordToken: typeof token === "string" && token.trim() !== "" ? discordTokenSchema.parse(token) : null,
  };
}

async function sealFor(id: number, secrets: ReturnType<typeof readSecrets>) {
  if (!secrets.rconPassword && !secrets.discordToken) return {};
  const key = await botPublicKey();
  return {
    ...(secrets.rconPassword ? { rconPasswordEnc: sealSecret(key, secrets.rconPassword, secretContext("online", id, "rconPassword")) } : {}),
    ...(secrets.discordToken ? { discordTokenEnc: sealSecret(key, secrets.discordToken, secretContext("online", id, "discordToken")) } : {}),
    secretsUpdatedAt: new Date(),
  };
}

const changed = (s: ReturnType<typeof readSecrets>) => ({ rconPasswordChanged: !!s.rconPassword, discordTokenChanged: !!s.discordToken });

export async function createServer(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  return runAction("any", async (user) => {
    const data = parseServer(fd);
    const secrets = readSecrets(fd);
    if (!secrets.rconPassword || !secrets.discordToken) throw new ActionError("Для нового сервера нужны и пароль RCON, и токен бота Discord");
    await botPublicKey();
    if ((await prisma.onlineServer.count()) >= 50) throw new ActionError("Больше 50 серверов добавить нельзя");

    const server = await prisma.$transaction(async (tx) => {
      const row = await tx.onlineServer.create({ data });
      return tx.onlineServer.update({ where: { id: row.id }, data: await sealFor(row.id, secrets) });
    });
    await audit(user, MODULE, "online.server.create", server.name, { ...data, ...changed(secrets) });
    revalidatePath("/online", "layout");
    return `Сервер «${server.name}» добавлен. Бот подключится к нему в течение 10 секунд.`;
  });
}

export async function updateServer(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  return runAction("any", async (user) => {
    const id = idParam(fd);
    const data = parseServer(fd);
    const secrets = readSecrets(fd);
    const server = await prisma.onlineServer.update({ where: { id }, data: { ...data, ...(await sealFor(id, secrets)) } });
    await audit(user, MODULE, "online.server.update", server.name, { ...data, ...changed(secrets) });
    revalidatePath("/online", "layout");
    return `Сервер «${server.name}» сохранён.`;
  });
}

export async function deleteServer(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  return runAction("any", async (user) => {
    const id = idParam(fd);
    const server = await prisma.onlineServer.delete({ where: { id } });
    await audit(user, MODULE, "online.server.delete", server.name, { host: server.host, port: server.port });
    revalidatePath("/online", "layout");
    return `Сервер «${server.name}» удалён, его бот отключится в течение 10 секунд.`;
  });
}

export async function saveOnlineSettings(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  return runAction("any", async (user) => {
    const data = onlineSettingsSchema.parse({
      pollIntervalMs: int(fd, "pollIntervalSec") * 1000,
      connectTimeoutMs: int(fd, "connectTimeoutSec") * 1000,
      responseTimeoutMs: int(fd, "responseTimeoutSec") * 1000,
      offlineText: str(fd, "offlineText"),
      startingText: str(fd, "startingText"),
      onlineText: str(fd, "onlineText"),
      queueText: str(fd, "queueText"),
    });
    await prisma.onlineSettings.upsert({ where: { id: 1 }, create: { id: 1, ...data }, update: data });
    await audit(user, MODULE, "online.settings", null, data);
    revalidatePath("/online", "layout");
    return "Настройки сохранены. Боты переподключатся с новыми настройками в течение 10 секунд.";
  });
}

// ---------- Уведомления в Telegram ----------

export async function saveOnlineTelegram(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  return runAction("any", async (user) => {
    const data = onlineTelegramSchema.parse({
      chatIds: parseTelegramChats(str(fd, "chatIds")),
      notifyOffline: bool(fd, "notifyOffline"),
      notifyOnline: bool(fd, "notifyOnline"),
      delaySec: int(fd, "delaySec"),
      offlineText: str(fd, "offlineText"),
      onlineText: str(fd, "onlineText"),
    });
    await prisma.onlineTelegram.upsert({ where: { id: 1 }, create: { id: 1, ...data }, update: data });
    await audit(user, MODULE, "online.telegram", null, data);
    revalidatePath("/online/telegram");
    return "Уведомления сохранены. Бот применит их в течение нескольких секунд.";
  });
}

export async function saveOnlineTelegramToken(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  return runAction("full", async (user) => {
    const token = telegramTokenSchema.parse(str(fd, "telegramToken"));
    // Два модуля не могут читать сообщения одного Telegram-бота: у другого перестали бы работать кнопки.
    const taken = await telegramBotTakenBy(token, "online");
    if (taken) throw new ActionError(`Этот Telegram-бот уже подключён: ${taken}. Для уведомлений создай отдельного бота в @BotFather.`);
    const key = await botPublicKey();
    const hint = telegramTokenHint(token);
    const data = {
      tokenEnc: sealSecret(key, token, ONLINE_TELEGRAM_TOKEN_CONTEXT),
      tokenHint: hint,
      tokenSetAt: new Date(),
      tokenSetByName: user.username,
      botUsername: null,
      botError: null,
    };
    await prisma.onlineTelegram.upsert({ where: { id: 1 }, create: { id: 1, ...data }, update: data });
    // Сам токен в журнал не пишем.
    await audit(user, MODULE, "online.telegram.token", hint);
    revalidatePath("/online/telegram");
    return "Токен сохранён. Бот подключится к Telegram в течение нескольких секунд.";
  });
}

export async function clearOnlineTelegramToken(_prev: ActionResult, _fd: FormData): Promise<ActionResult> {
  return runAction("full", async (user) => {
    await prisma.onlineTelegram.updateMany({ data: { tokenEnc: null, tokenHint: null, tokenSetAt: null, tokenSetByName: null, botUsername: null, botError: null } });
    await audit(user, MODULE, "online.telegram.token.clear", null);
    revalidatePath("/online/telegram");
    return "Токен удалён: уведомления в Telegram отключены.";
  });
}

// Просит бота отправить пробное сообщение и ждёт результат до 15 секунд.
export async function testOnlineTelegram(_prev: ActionResult, _fd: FormData): Promise<ActionResult> {
  return runAction("any", async (user) => {
    const requested = new Date();
    await prisma.onlineTelegram.upsert({ where: { id: 1 }, create: { id: 1, testRequestedAt: requested }, update: { testRequestedAt: requested } });
    await audit(user, MODULE, "online.telegram.test", null);
    const deadline = Date.now() + 15_000;
    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 500));
      const row = await prisma.onlineTelegram.findUnique({ where: { id: 1 } });
      if (row?.testDoneAt && row.testDoneAt >= requested) {
        revalidatePath("/online/telegram");
        if (!row.testOk) throw new ActionError(row.testResult ?? "Не отправилось");
        return row.testResult ?? "Отправлено";
      }
    }
    throw new ActionError("Бот онлайна не ответил за 15 секунд: проверь, что он запущен.");
  });
}
