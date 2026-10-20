"use server";

import { revalidatePath } from "next/cache";
import {
  discordTokenSchema,
  onlineServerSchema,
  onlineSettingsSchema,
  prisma,
  rconPasswordSchema,
  sealSecret,
  secretContext,
} from "@flamebot/core";
import { ActionError, audit, runAction, type ActionResult } from "@/lib/auth";
import { bool, idParam, int, intOrNull, str } from "@/lib/form";

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
