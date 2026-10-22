"use server";

import { revalidatePath } from "next/cache";
import {
  channelSettingsSchema,
  customRoleSettingsSchema,
  levelTotalExp,
  memberAdjustSchema,
  messageSettingsSchema,
  prisma,
  rankSchema,
  round2,
  repSettingsSchema,
  shopItemSchema,
  xpSettingsSchema,
} from "@flamebot/core";
import {
  CARD_FILE_FORMAT,
  CARD_FILE_MAX_BYTES,
  cardAssetIds,
  cardFileSchema,
  cardLayoutSchema,
  remapCardAssets,
  type CardFile,
  type CardLayout,
} from "@flamebot/core/card";
import { ActionError, audit, runAction, type ActionResult } from "@/lib/auth";
import { sanitizeImage } from "@/lib/images";
import { rateLimit } from "@/lib/rateLimit";
import { bool, dec, decOrNull, idParam, ids, int, intOrNull, str, strOrNull } from "@/lib/form";
import { assertChannels, assertGrantableRole } from "@/lib/guild";

const MODULE = "rating";

async function saveSettings<T extends object>(data: T) {
  await prisma.ratingSettings.upsert({ where: { id: 1 }, create: { id: 1, ...data }, update: data });
}

// Ранги поменялись: бот в фоне пересчитает роли всем участникам. Сначала проверка участника
// подтянет опыт до роли ранга, которая у человека уже есть, — так никто не потеряет свою роль.
async function queueRoleSyncForAll() {
  await prisma.member.updateMany({ where: { inGuild: true }, data: { needsRoleSync: true, needsMemberCheck: true } });
}

export async function saveXpSettings(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  return runAction("any", async (user) => {
    const data = xpSettingsSchema.parse({
      xpMin: dec(fd, "xpMin"),
      xpMax: dec(fd, "xpMax"),
      xpCooldownSec: int(fd, "xpCooldownSec"),
      minMessageLength: int(fd, "minMessageLength"),
      scrapPerAward: dec(fd, "scrapPerAward"),
      voiceXpEnabled: bool(fd, "voiceXpEnabled"),
      voiceXpPerMember: int(fd, "voiceXpPerMember"),
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
    const mode = str(fd, "xpMode");
    if (mode !== "all" && mode !== "selected") throw new ActionError("Выбери, где начисляется опыт");
    const data = channelSettingsSchema.parse({
      announceChannelId: strOrNull(fd, "announceChannelId"),
      // Пустой список в базе означает «во всех каналах».
      xpChannelIds: mode === "all" ? [] : ids(fd, "xpChannelIds"),
      commandChannelIds: ids(fd, "commandChannelIds"),
    });
    if (mode === "selected" && data.xpChannelIds.length === 0) {
      throw new ActionError("Отметь хотя бы один канал, где начисляется опыт, или выбери «Во всех каналах»");
    }
    await assertChannels([data.announceChannelId, ...data.xpChannelIds, ...data.commandChannelIds]);
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
  const rank = rankSchema.parse({
    name: str(fd, "name"),
    emoji: strOrNull(fd, "emoji"),
    minLevel: int(fd, "minLevel"),
    roleId: strOrNull(fd, "roleId"),
    scrapReward: int(fd, "scrapReward"),
    xpMin: decOrNull(fd, "xpMin"),
    xpMax: decOrNull(fd, "xpMax"),
    scrapPerMessage: decOrNull(fd, "scrapPerMessage"),
  });
  // Порог опыта — опыт уровня по формуле JuniperBot.
  return { ...rank, minXp: levelTotalExp(rank.minLevel) };
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
      delta: dec(fd, "delta"),
      reason: str(fd, "reason"),
    });
    if (data.delta === 0) throw new ActionError("Изменение не может быть нулевым");
    if (data.field === "rep" && !Number.isInteger(data.delta)) throw new ActionError("Репутация меняется только целыми числами");

    const member = await prisma.$transaction(async (tx) => {
      const current = await tx.member.findUnique({ where: { id: data.memberId } });
      if (!current) throw new ActionError("Игрок не найден");
      const next = Math.max(0, round2(current[data.field] + data.delta));
      return tx.member.update({
        where: { id: data.memberId },
        data: { [data.field]: next, ...(data.field === "xp" ? { needsRoleSync: true } : {}) },
      });
    });

    await audit(user, MODULE, "member.adjust", `${member.displayName} (${member.id})`, { ...data, memberId: member.id });
    revalidatePath("/rating/members", "layout");
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
      memberId,
    });
    revalidatePath("/rating/members", "layout");
    return `Игрок ${before.displayName} обнулён.`;
  });
}

// ---------- Карточка профиля ----------

function parseLayout(json: string): CardLayout {
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
  return layout;
}

async function assertCardAssets(layout: CardLayout) {
  const assetIds = cardAssetIds(layout);
  const found = await prisma.cardAsset.count({ where: { id: { in: assetIds } } });
  if (found !== assetIds.length) throw new ActionError("Одна из картинок не найдена. Загрузи её заново.");
}

// Картинки, которые не нужны ни текущей карточке, ни сохранённым и загружены давно, удаляем.
async function cleanupCardAssets(current: CardLayout) {
  const keep = new Set(cardAssetIds(current));
  for (const preset of await prisma.cardPreset.findMany({ select: { layout: true } })) {
    const parsed = cardLayoutSchema.safeParse(preset.layout);
    if (parsed.success) for (const id of cardAssetIds(parsed.data)) keep.add(id);
  }
  await prisma.cardAsset.deleteMany({
    where: { id: { notIn: [...keep] }, createdAt: { lt: new Date(Date.now() - 24 * 3_600_000) } },
  });
}

export async function saveCardLayout(json: string): Promise<ActionResult> {
  return runAction("any", async (user) => {
    const layout = parseLayout(json);
    await assertCardAssets(layout);
    await prisma.profileCard.upsert({ where: { id: 1 }, create: { id: 1, layout }, update: { layout } });
    await cleanupCardAssets(layout);
    await audit(user, MODULE, "card.update", null, { elements: layout.elements.length, assets: cardAssetIds(layout) });
    revalidatePath("/rating/card");
    return "Карточка сохранена. Бот начнёт рисовать её в течение 15 секунд.";
  });
}

// ---------- Сохранённые карточки и файлы ----------

const MAX_CARD_PRESETS = 50;

export async function saveCardPreset(name: string, json: string): Promise<ActionResult> {
  return runAction("any", async (user) => {
    const title = typeof name === "string" ? name.trim() : "";
    if (!title) throw new ActionError("Напиши название");
    if (title.length > 40) throw new ActionError("Название длиннее 40 символов");
    const layout = parseLayout(json);
    await assertCardAssets(layout);
    const existing = await prisma.cardPreset.findUnique({ where: { name: title }, select: { id: true } });
    if (!existing && (await prisma.cardPreset.count()) >= MAX_CARD_PRESETS) {
      throw new ActionError(`Сохранить можно не больше ${MAX_CARD_PRESETS} карточек. Удали ненужные.`);
    }
    await prisma.cardPreset.upsert({ where: { name: title }, create: { name: title, layout }, update: { layout } });
    await audit(user, MODULE, existing ? "card.preset.update" : "card.preset.create", title, { elements: layout.elements.length });
    revalidatePath("/rating/card");
    return existing ? `Карточка «${title}» перезаписана.` : `Карточка «${title}» сохранена.`;
  });
}

export async function deleteCardPreset(id: number): Promise<ActionResult> {
  return runAction("any", async (user) => {
    if (!Number.isInteger(id) || id <= 0) throw new ActionError("Карточка не найдена");
    const preset = await prisma.cardPreset.findUnique({ where: { id }, select: { name: true } });
    if (!preset) throw new ActionError("Карточка уже удалена");
    await prisma.cardPreset.delete({ where: { id } });
    await audit(user, MODULE, "card.preset.delete", preset.name);
    revalidatePath("/rating/card");
    return `Карточка «${preset.name}» удалена.`;
  });
}

export type CardFileResult = { ok: boolean; message: string; file?: string };

// Собирает файл карточки: шаблон и картинки из базы в base64.
export async function exportCardFile(name: string, json: string): Promise<CardFileResult> {
  let file: string | undefined;
  const result = await runAction("any", async () => {
    const layout = parseLayout(json);
    const assets = await prisma.cardAsset.findMany({ where: { id: { in: cardAssetIds(layout) } } });
    const content: CardFile = {
      format: CARD_FILE_FORMAT,
      version: 1,
      name: typeof name === "string" && name.trim() ? name.trim().slice(0, 40) : undefined,
      exportedAt: new Date().toISOString(),
      layout,
      assets: assets.map((a) => ({ id: a.id, mime: a.mime, data: Buffer.from(a.data).toString("base64") })),
    };
    file = JSON.stringify(content, null, 2);
    return "Файл готов.";
  });
  return { ok: result?.ok ?? false, message: result?.message ?? "Не получилось собрать файл", file };
}

export type CardImportResult = { ok: boolean; message: string; layout?: CardLayout; name?: string };

// Читает файл карточки: картинки проверяются и сохраняются заново, шаблон открывается в редакторе.
// Карточку бота это не меняет, пока её не сохранят.
export async function importCardFile(fd: FormData): Promise<CardImportResult> {
  let layout: CardLayout | undefined;
  let name: string | undefined;
  const result = await runAction("any", async (user) => {
    if (!rateLimit(`upload:${user.id}`, 20, 10 * 60_000)) throw new ActionError("Слишком много загрузок. Подожди несколько минут.");
    const file = fd.get("file");
    if (!(file instanceof File)) throw new ActionError("Выбери файл");
    if (file.size === 0) throw new ActionError("Файл пустой");
    if (file.size > CARD_FILE_MAX_BYTES) throw new ActionError("Файл больше 15 МБ");

    let raw: unknown;
    try {
      raw = JSON.parse(await file.text());
    } catch {
      throw new ActionError("Это не файл карточки: внутри не JSON");
    }
    // Голый шаблон без картинок тоже принимаем: его можно прислать текстом.
    const wrapped = raw && typeof raw === "object" && "format" in raw ? raw : { format: CARD_FILE_FORMAT, version: 1, layout: raw };
    const parsedFile = cardFileSchema.safeParse(wrapped);
    if (!parsedFile.success) throw new ActionError("Это не файл карточки FlameBot или он из другой версии");
    const parsedLayout = cardLayoutSchema.safeParse(parsedFile.data.layout);
    if (!parsedLayout.success) throw new ActionError(`Шаблон в файле повреждён: ${parsedLayout.error.issues[0]?.message ?? "ошибка"}`);

    const needed = new Set(cardAssetIds(parsedLayout.data));
    const map = new Map<number, number>();
    for (const asset of parsedFile.data.assets) {
      if (!needed.has(asset.id) || map.has(asset.id)) continue;
      const img = await sanitizeImage(new File([Buffer.from(asset.data, "base64")], `card-${asset.id}`, { type: asset.mime }));
      const row = await prisma.cardAsset.create({
        data: { mime: img.mime, width: img.width, height: img.height, size: img.data.length, data: new Uint8Array(img.data) },
        select: { id: true },
      });
      map.set(asset.id, row.id);
    }
    layout = remapCardAssets(parsedLayout.data, map);
    name = parsedFile.data.name || undefined;
    const lost = needed.size - map.size;
    await audit(user, MODULE, "card.import", name ?? file.name.slice(0, 80), { elements: layout.elements.length, assets: map.size, lost });
    const tail = lost > 0 ? ` Картинок в файле не хватило: ${lost}, их места пустые.` : "";
    return `Карточка из файла открыта в редакторе. Чтобы бот рисовал её, нажми «Сохранить».${tail}`;
  });
  return { ok: result?.ok ?? false, message: result?.message ?? "Не получилось прочитать файл", layout, name };
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

// ---------- Проверка личных ролей ----------

export async function saveCustomRoleSettings(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  return runAction("any", async (user) => {
    const data = customRoleSettingsSchema.parse({
      customRoleApproval: bool(fd, "customRoleApproval"),
      approvalChannelId: strOrNull(fd, "approvalChannelId"),
    });
    await assertChannels([data.approvalChannelId]);
    await saveSettings(data);
    await audit(user, MODULE, "customrole.settings", null, data);
    revalidatePath("/rating/shop");
    return data.customRoleApproval
      ? "Проверка включена: личные роли будут приходить заявками в выбранный канал."
      : "Проверка выключена: личные роли выдаются сразу после покупки.";
  });
}

// ---------- Карточка игрока: бейджи и покупки ----------

export async function giveBadge(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  return runAction("any", async (user) => {
    const memberId = str(fd, "memberId");
    const label = str(fd, "label").trim();
    if (label.length < 1 || label.length > 40) throw new ActionError("Текст бейджа — от 1 до 40 символов");
    const member = await prisma.member.findUnique({ where: { id: memberId } });
    if (!member) throw new ActionError("Игрок не найден");
    await prisma.memberBadge.create({ data: { memberId, label } });
    await audit(user, MODULE, "member.badge.add", `${member.displayName} (${member.id})`, { label, memberId });
    revalidatePath("/rating/members", "layout");
    return `Бейдж «${label}» выдан игроку ${member.displayName}.`;
  });
}

export async function removeBadge(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  return runAction("any", async (user) => {
    const id = idParam(fd);
    const badge = await prisma.memberBadge.findUnique({ where: { id }, include: { member: true } });
    if (!badge) throw new ActionError("Бейдж уже снят");
    await prisma.memberBadge.delete({ where: { id } });
    await audit(user, MODULE, "member.badge.remove", `${badge.member.displayName} (${badge.memberId})`, { label: badge.label, memberId: badge.memberId });
    revalidatePath("/rating/members", "layout");
    return `Бейдж «${badge.label}» снят.`;
  });
}

// Досрочно завершает покупку роли. Саму роль снимает бот при ближайшей проверке сроков.
export async function endPurchase(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  return runAction("any", async (user) => {
    const id = idParam(fd);
    const reason = str(fd, "reason").trim();
    if (reason.length < 3 || reason.length > 200) throw new ActionError("Укажи причину (от 3 до 200 символов)");
    const purchase = await prisma.purchase.findUnique({ where: { id }, include: { item: true, member: true } });
    if (!purchase || !purchase.active) throw new ActionError("Покупка уже завершена");
    await prisma.purchase.update({ where: { id }, data: { expiresAt: new Date() } });
    await audit(user, MODULE, "purchase.end", `${purchase.member.displayName} (${purchase.memberId})`, {
      purchaseId: id,
      item: purchase.item.name,
      customName: purchase.customName,
      reason,
      memberId: purchase.memberId,
    });
    revalidatePath("/rating/members", "layout");
    return "Покупка завершена. Бот снимет роль в течение 5 минут.";
  });
}
