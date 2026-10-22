"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { SNOWFLAKE, generateLinkKey, hashLinkKey, linkKeyHint, linkSettingsSchema, prisma } from "@flamebot/core";
import { ActionError, audit, runAction, type ActionResult } from "@/lib/auth";
import { bool, idParam, int, str, strOrNull } from "@/lib/form";
import { assertChannels, assertGrantableRole } from "@/lib/guild";
import type { PanelUser } from "@/lib/session";

const MODULE = "link";

// Результат с ключом API: его показываем один раз, в базе остаётся только хеш.
export type KeyResult = (NonNullable<ActionResult> & { key?: string }) | null;

const serverName = z.string().trim().min(1, "Укажи название сервера").max(60, "Название — не больше 60 символов");

export async function saveLinkSettings(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  return runAction("any", async (user) => {
    const data = linkSettingsSchema.parse({
      channelId: strOrNull(fd, "channelId"),
      roleId: strOrNull(fd, "roleId"),
      codeTtlMinutes: int(fd, "codeTtlMinutes"),
      panelTitle: str(fd, "panelTitle"),
      // Переводы строк из браузера приходят как \r\n, в Discord они не нужны.
      panelText: str(fd, "panelText").replace(/\r\n/g, "\n"),
      buttonLabel: str(fd, "buttonLabel"),
    });
    await assertChannels([data.channelId]);
    if (data.channelId) {
      const channel = await prisma.guildChannel.findUnique({ where: { id: data.channelId } });
      if (channel && channel.type !== 0 && channel.type !== 5) throw new ActionError("Нужен текстовый канал: в форум бот сообщение с кнопкой не отправит");
    }
    await assertGrantableRole(data.roleId);
    await prisma.linkSettings.upsert({ where: { id: 1 }, create: { id: 1, ...data }, update: data });
    await audit(user, MODULE, "link.settings", null, { ...data, panelText: `${data.panelText.length} символов` });
    revalidatePath("/link", "layout");
    return "Настройки сохранены. Бот обновит сообщение в канале в течение 15 секунд.";
  });
}

// Отвязка: связь удаляется сразу, роль снимает бот (задание в LinkAction).
export async function unlinkSteam(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  return runAction("any", async (user) => {
    const discordId = str(fd, "discordId");
    if (!SNOWFLAKE.test(discordId)) throw new ActionError("Неверный Discord ID");
    const link = await prisma.$transaction(async (tx) => {
      const row = await tx.steamLink.findUnique({ where: { discordId } });
      if (!row) return null;
      await tx.steamLink.delete({ where: { discordId } });
      await tx.linkAction.create({ data: { kind: "unlink", discordId } });
      return row;
    });
    if (!link) throw new ActionError("Эта привязка уже удалена");
    await audit(user, MODULE, "link.unlink", `${link.discordName} ↔ ${link.steamName}`, { discordId, steamId: link.steamId });
    revalidatePath("/link", "layout");
    return `Привязка ${link.discordName} ↔ ${link.steamName} удалена. Бот снимет роль в течение 10 секунд, игрок может привязаться заново.`;
  });
}

async function withKey(fn: (user: PanelUser, key: string) => Promise<string>): Promise<KeyResult> {
  const key = generateLinkKey();
  const res = await runAction("full", (user) => fn(user, key));
  return res?.ok ? { ...res, key } : res;
}

export async function createLinkServer(_prev: KeyResult, fd: FormData): Promise<KeyResult> {
  return withKey(async (user, key) => {
    const name = serverName.parse(str(fd, "name"));
    const server = await prisma.linkServer.create({ data: { name, keyHash: hashLinkKey(key), keyHint: linkKeyHint(key) } });
    await audit(user, MODULE, "link.server.create", name, { serverId: server.id });
    revalidatePath("/link", "layout");
    return `Сервер «${name}» добавлен.`;
  });
}

export async function resetLinkServerKey(_prev: KeyResult, fd: FormData): Promise<KeyResult> {
  return withKey(async (user, key) => {
    const id = idParam(fd);
    const server = await prisma.linkServer.update({ where: { id }, data: { keyHash: hashLinkKey(key), keyHint: linkKeyHint(key) } }).catch(() => null);
    if (!server) throw new ActionError("Сервер не найден");
    await audit(user, MODULE, "link.server.key", server.name, { serverId: id });
    revalidatePath("/link", "layout");
    return `Ключ сервера «${server.name}» заменён. Старый перестанет работать в течение 30 секунд.`;
  });
}

export async function updateLinkServer(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  return runAction("full", async (user) => {
    const id = idParam(fd);
    const data = { name: serverName.parse(str(fd, "name")), enabled: bool(fd, "enabled") };
    const server = await prisma.linkServer.update({ where: { id }, data }).catch(() => null);
    if (!server) throw new ActionError("Сервер не найден");
    await audit(user, MODULE, "link.server.update", server.name, { serverId: id, enabled: data.enabled });
    revalidatePath("/link", "layout");
    return data.enabled ? "Сохранено." : "Сохранено. Сервер отключён: бот перестанет принимать его запросы в течение 30 секунд.";
  });
}

export async function deleteLinkServer(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  return runAction("full", async (user) => {
    const id = idParam(fd);
    const server = await prisma.linkServer.delete({ where: { id } }).catch(() => null);
    if (!server) throw new ActionError("Сервер не найден");
    await audit(user, MODULE, "link.server.delete", server.name, { serverId: id });
    revalidatePath("/link", "layout");
    return `Сервер «${server.name}» удалён. Привязки игроков остались.`;
  });
}
