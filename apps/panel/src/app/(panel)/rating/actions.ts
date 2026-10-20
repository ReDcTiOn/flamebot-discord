"use server";

import { revalidatePath } from "next/cache";
import {
  channelSettingsSchema,
  memberAdjustSchema,
  messageSettingsSchema,
  prisma,
  rankSchema,
  repSettingsSchema,
  shopItemSchema,
  xpSettingsSchema,
} from "@flamebot/core";
import { cardAssetIds, cardLayoutSchema } from "@flamebot/core/card";
import { ActionError, audit, runAction, type ActionResult } from "@/lib/auth";
import { sanitizeImage } from "@/lib/images";
import { rateLimit } from "@/lib/rateLimit";
import { bool, idParam, ids, int, intOrNull, str, strOrNull } from "@/lib/form";
import { assertChannels, assertGrantableRole } from "@/lib/guild";

const MODULE = "rating";

async function saveSettings<T extends object>(data: T) {
  await prisma.ratingSettings.upsert({ where: { id: 1 }, create: { id: 1, ...data }, update: data });
}

// Ранги поменялись: бот в фоне пересчитает роли всем участникам.
async function queueRoleSyncForAll() {
  await prisma.member.updateMany({ where: { inGuild: true }, data: { needsRoleSync: true } });
}

export async function saveXpSettings(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  return runAction("any", async (user) => {
    const data = xpSettingsSchema.parse({
      xpMin: int(fd, "xpMin"),
      xpMax: int(fd, "xpMax"),
      xpCooldownSec: int(fd, "xpCooldownSec"),
      minMessageLength: int(fd, "minMessageLength"),
      scrapPerAward: int(fd, "scrapPerAward"),
      announceRankUp: bool(fd, "announceRankUp"),
      removeOldRankRoles: bool(fd, "removeOldRankRoles"),
    });
    await saveSettings(data);
    await audit(user, MODULE, "xp.update", null, data);
    revalidatePath("/rating", "layout");
    return "Настройки опыта сохранены. Бот применит их в течение 15 секунд.";
  });
}

export async function saveRepSettings(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  return runAction("any", async (user) => {
    const data = repSettingsSchema.parse({
      repCooldownHours: int(fd, "repCooldownHours"),
      repSameTargetDays: int(fd, "repSameTargetDays"),
      repMinMemberDays: int(fd, "repMinMemberDays"),
    });
    await saveSettings(data);
    await audit(user, MODULE, "rep.update", null, data);
    revalidatePath("/rating/rep");
    return "Настройки репутации сохранены.";
  });
}

export async function saveChannelSettings(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  return runAction("any", async (user) => {
    const data = channelSettingsSchema.parse({
      announceChannelId: strOrNull(fd, "announceChannelId"),
      ignoredChannelIds: ids(fd, "ignoredChannelIds"),
      commandChannelIds: ids(fd, "commandChannelIds"),
    });
    await assertChannels([data.announceChannelId, ...data.ignoredChannelIds, ...data.commandChannelIds]);
    await saveSettings(data);
    await audit(user, MODULE, "channels.update", null, data);
    revalidatePath("/rating/channels");
    return "Каналы сохранены.";
  });
}

export async function saveMessageSettings(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  return runAction("any", async (user) => {
    const data = messageSettingsSchema.parse({ rankUpMessage: str(fd, "rankUpMessage") });
    await saveSettings(data);
    await audit(user, MODULE, "messages.update", null, data);
    revalidatePath("/rating/messages");
    return "Текст сохранён.";
  });
}

function parseRank(fd: FormData) {
  return rankSchema.parse({
    name: str(fd, "name"),
    emoji: strOrNull(fd, "emoji"),
    minXp: int(fd, "minXp"),
    roleId: strOrNull(fd, "roleId"),
    scrapReward: int(fd, "scrapReward"),
  });
}

export async function createRank(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  return runAction("any", async (user) => {
    const data = parseRank(fd);
    if ((await prisma.rank.count()) >= 50) throw new ActionError("Больше 50 рангов сделать нельзя");
    await assertGrantableRole(data.roleId);
    const rank = await prisma.rank.create({ data });
    await queueRoleSyncForAll();
    await audit(user, MODULE, "rank.create", rank.name, data);
    revalidatePath("/rating/xp");
    return `Ранг «${rank.name}» добавлен.`;
  });
}

export async function updateRank(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  return runAction("any", async (user) => {
    const id = idParam(fd);
    const data = parseRank(fd);
    await assertGrantableRole(data.roleId);
    const rank = await prisma.rank.update({ where: { id }, data });
    await queueRoleSyncForAll();
    await audit(user, MODULE, "rank.update", rank.name, data);
    revalidatePath("/rating/xp");
    return `Ранг «${rank.name}» сохранён. Роли участников обновятся в фоне.`;
  });
}

export async function deleteRank(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  return runAction("any", async (user) => {
    const id = idParam(fd);
    const rank = await prisma.rank.delete({ where: { id } });
    await queueRoleSyncForAll();
    await audit(user, MODULE, "rank.delete", rank.name);
    revalidatePath("/rating/xp");
    return `Ранг «${rank.name}» удалён.`;
  });
}

function parseShopItem(fd: FormData) {
  const type = str(fd, "type");
  return shopItemSchema.parse({
    name: str(fd, "name"),
    description: str(fd, "description"),
    type,
    price: int(fd, "price"),
    roleId: type === "ROLE" ? strOrNull(fd, "roleId") : null,
    durationDays: type === "BADGE" ? null : intOrNull(fd, "durationDays"),
    badgeLabel: type === "BADGE" ? strOrNull(fd, "badgeLabel") : null,
    enabled: bool(fd, "enabled"),
    stock: intOrNull(fd, "stock"),
    sortOrder: intOrNull(fd, "sortOrder") ?? 0,
  });
}

export async function createShopItem(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  return runAction("any", async (user) => {
    const data = parseShopItem(fd);
    if ((await prisma.shopItem.count()) >= 100) throw new ActionError("Больше 100 товаров сделать нельзя");
    await assertGrantableRole(data.roleId);
    const item = await prisma.shopItem.create({ data });
    await audit(user, MODULE, "shop.create", item.name, data);
    revalidatePath("/rating/shop");
    return `Товар «${item.name}» добавлен.`;
  });
}

export async function updateShopItem(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  return runAction("any", async (user) => {
    const id = idParam(fd);
    const data = parseShopItem(fd);
    await assertGrantableRole(data.roleId);
    const item = await prisma.shopItem.update({ where: { id }, data });
    await audit(user, MODULE, "shop.update", item.name, data);
    revalidatePath("/rating/shop");
    return `Товар «${item.name}» сохранён.`;
  });
}

export async function deleteShopItem(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  return runAction("any", async (user) => {
    const id = idParam(fd);
    const purchases = await prisma.purchase.count({ where: { itemId: id } });
    if (purchases > 0) {
      // Историю покупок не теряем: товар просто снимаем с продажи.
      const item = await prisma.shopItem.update({ where: { id }, data: { enabled: false } });
      await audit(user, MODULE, "shop.update", item.name, { enabled: false });
      revalidatePath("/rating/shop");
      return `У товара «${item.name}» есть покупки, поэтому он снят с продажи, а не удалён.`;
    }
    const item = await prisma.shopItem.delete({ where: { id } });
    await audit(user, MODULE, "shop.delete", item.name);
    revalidatePath("/rating/shop");
    return `Товар «${item.name}» удалён.`;
  });
}

export async function adjustMember(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  return runAction("any", async (user) => {
    const data = memberAdjustSchema.parse({
      memberId: str(fd, "memberId"),
      field: str(fd, "field"),
      delta: int(fd, "delta"),
      reason: str(fd, "reason"),
    });
    if (data.delta === 0) throw new ActionError("Изменение не может быть нулевым");

    const member = await prisma.$transaction(async (tx) => {
      const current = await tx.member.findUnique({ where: { id: data.memberId } });
      if (!current) throw new ActionError("Игрок не найден");
      const next = Math.max(0, current[data.field] + data.delta);
      return tx.member.update({
        where: { id: data.memberId },
        data: { [data.field]: next, ...(data.field === "xp" ? { needsRoleSync: true } : {}) },
      });
    });

    await audit(user, MODULE, "member.adjust", `${member.displayName} (${member.id})`, data);
    revalidatePath("/rating/members");
    const label = { xp: "Опыт", scrap: "Скрап", rep: "Репутация" }[data.field];
    return `${label} игрока ${member.displayName}: теперь ${member[data.field].toLocaleString("ru-RU")}.`;
  });
}

export async function resetMember(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  return runAction("any", async (user) => {
    const memberId = str(fd, "memberId");
    const reason = str(fd, "reason").trim();
    if (reason.length < 3 || reason.length > 200) throw new ActionError("Укажи причину (от 3 до 200 символов)");
    const before = await prisma.member.findUnique({ where: { id: memberId } });
    if (!before) throw new ActionError("Игрок не найден");
    await prisma.$transaction([
      prisma.member.update({
        where: { id: memberId },
        data: { xp: 0, scrap: 0, rep: 0, rewardedUpToXp: 0, needsRoleSync: true },
      }),
      prisma.memberBadge.deleteMany({ where: { memberId } }),
    ]);
    await audit(user, MODULE, "member.reset", `${before.displayName} (${before.id})`, {
      reason,
      before: { xp: before.xp, scrap: before.scrap, rep: before.rep },
    });
    revalidatePath("/rating/members");
    return `Игрок ${before.displayName} обнулён.`;
  });
}

// ---------- Карточка профиля ----------

export async function saveCardLayout(json: string): Promise<ActionResult> {
  return runAction("any", async (user) => {
    if (typeof json !== "string" || json.length > 200_000) throw new ActionError("Шаблон слишком большой");
    let raw: unknown;
    try {
      raw = JSON.parse(json);
    } catch {
      throw new ActionError("Шаблон повреждён");
    }
    const layout = cardLayoutSchema.parse(raw);
    const ids = new Set(layout.elements.map((e) => e.id));
    if (ids.size !== layout.elements.length) throw new ActionError("У элементов повторяются идентификаторы");

    const assetIds = cardAssetIds(layout);
    const found = await prisma.cardAsset.count({ where: { id: { in: assetIds } } });
    if (found !== assetIds.length) throw new ActionError("Одна из картинок не найдена. Загрузи её заново.");

    await prisma.profileCard.upsert({ where: { id: 1 }, create: { id: 1, layout }, update: { layout } });
    // Картинки, которые больше нигде не используются и загружены давно, удаляем.
    await prisma.cardAsset.deleteMany({
      where: { id: { notIn: assetIds }, createdAt: { lt: new Date(Date.now() - 24 * 3_600_000) } },
    });
    await audit(user, MODULE, "card.update", null, { elements: layout.elements.length, assets: assetIds });
    revalidatePath("/rating/card");
    return "Карточка сохранена. Бот начнёт рисовать её в течение 15 секунд.";
  });
}

export async function saveProfileCardEnabled(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  return runAction("any", async (user) => {
    const profileCardEnabled = bool(fd, "profileCardEnabled");
    await saveSettings({ profileCardEnabled });
    await audit(user, MODULE, "card.toggle", null, { profileCardEnabled });
    revalidatePath("/rating/card");
    return profileCardEnabled ? "/profile теперь показывает картинку." : "/profile теперь показывает текстовую карточку.";
  });
}

export type UploadResult = { ok: boolean; message: string; asset?: { id: number; width: number; height: number } };

export async function uploadCardAsset(fd: FormData): Promise<UploadResult> {
  let asset: { id: number; width: number; height: number } | undefined;
  const result = await runAction("any", async (user) => {
    if (!rateLimit(`upload:${user.id}`, 20, 10 * 60_000)) throw new ActionError("Слишком много загрузок. Подожди несколько минут.");
    const file = fd.get("file");
    if (!(file instanceof File)) throw new ActionError("Выбери файл");
    const img = await sanitizeImage(file);
    const row = await prisma.cardAsset.create({
      data: { mime: img.mime, width: img.width, height: img.height, size: img.data.length, data: new Uint8Array(img.data) },
      select: { id: true, width: true, height: true },
    });
    asset = row;
    await audit(user, MODULE, "card.upload", `#${row.id}`, { width: row.width, height: row.height, size: img.data.length });
    return "Картинка загружена.";
  });
  return { ok: result?.ok ?? false, message: result?.message ?? "Не получилось загрузить картинку", asset };
}
