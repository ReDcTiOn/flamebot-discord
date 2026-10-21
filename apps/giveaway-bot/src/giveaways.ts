import { randomInt } from "node:crypto";
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  Colors,
  DiscordAPIError,
  EmbedBuilder,
  MessageFlags,
  RESTJSONErrorCodes,
  escapeMarkdown,
  type Guild,
  type GuildMember,
  type GuildTextBasedChannel,
  type MessageActionRowComponentBuilder,
} from "discord.js";
import { prisma, renderTemplate, type Giveaway, type GiveawayPromoCode } from "@flamebot/core";
import { event, log } from "./events.js";
import { getSettings, mentions, unix, withLock } from "./util.js";

export const JOIN_BUTTON_ID = "giveaway:join";
// Фирменный оранжевый цвет Flame.
export const EMBED_COLOR = 0xff5a1f;

export type GiveawayFull = Giveaway & { hasPromo: boolean; entryCount: number };

// Розыгрыши, у которых надо обновить счётчик участников в сообщении.
export const dirty = new Set<number>();

export async function loadGiveaway(where: { id: number } | { messageId: string }): Promise<GiveawayFull | null> {
  const row = await prisma.giveaway.findUnique({ where, include: { _count: { select: { entries: true, promoCodes: true } } } });
  if (!row) return null;
  const { _count, ...g } = row;
  return { ...g, hasPromo: _count.promoCodes > 0, entryCount: _count.entries };
}

export const jumpUrl = (guildId: string, g: Giveaway) => `https://discord.com/channels/${guildId}/${g.channelId}/${g.messageId}`;

export function joinRow() {
  return new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
    new ButtonBuilder().setCustomId(JOIN_BUTTON_ID).setLabel("Участвовать").setEmoji("🎉").setStyle(ButtonStyle.Success),
  );
}

export function buildEmbed(g: GiveawayFull, guild: Guild): EmbedBuilder {
  const ends = unix(g.endsAt);
  let embed: EmbedBuilder;
  if (g.status === "ACTIVE") {
    embed = new EmbedBuilder()
      .setTitle(`🎁 ${g.prize}`)
      .setDescription(g.description)
      .setColor(EMBED_COLOR)
      .addFields(
        { name: "🏆 Победителей", value: String(g.winnersCount), inline: true },
        { name: "👥 Участников", value: String(g.entryCount), inline: true },
        { name: "⏰ Итоги", value: `<t:${ends}:F>\n<t:${ends}:R>` },
      )
      .setFooter({ text: "Жми «Участвовать», чтобы испытать удачу" });
    if (g.boostersOnly) embed.addFields({ name: "🚀 Условие", value: "Участвовать могут только **бустеры сервера**" });
    if (g.hasPromo) {
      embed.addFields({
        name: "📩 Получение приза",
        value: "Промокод придёт победителю в личные сообщения - проверь, открыто ли у тебя ЛС от участников сервера.",
      });
    }
  } else if (g.status === "ENDED") {
    embed = new EmbedBuilder()
      .setTitle(`🏁 ${g.prize}`)
      .setDescription(g.description)
      .setColor(Colors.DarkGrey)
      .addFields(
        { name: "🏆 Победители", value: g.winners.map((id) => `🥇 <@${id}>`).join("\n") || "Никого - не хватило участников" },
        { name: "👥 Участников", value: String(g.entryCount), inline: true },
        { name: "⏰ Итоги подведены", value: `<t:${ends}:F>`, inline: true },
      )
      .setFooter({ text: "Розыгрыш завершён" });
  } else {
    embed = new EmbedBuilder().setTitle(`❌ ${g.prize}`).setDescription("Розыгрыш отменён.").setColor(Colors.Red);
  }
  return embed.setAuthor({ name: `${guild.name} · Розыгрыш`, iconURL: guild.iconURL() ?? undefined });
}

const isCode = (err: unknown, code: number) => err instanceof DiscordAPIError && err.code === code;

export async function resolveChannel(guild: Guild, channelId: string): Promise<GuildTextBasedChannel | null> {
  const channel = guild.channels.cache.get(channelId) ?? (await guild.client.channels.fetch(channelId).catch(() => null));
  if (!channel || channel.isDMBased() || !channel.isTextBased() || channel.guildId !== guild.id) return null;
  return channel;
}

// Перерисовывает сообщение розыгрыша. removeView — убрать кнопку «Участвовать».
export async function updateMessage(guild: Guild, g: GiveawayFull, removeView = false): Promise<string | null> {
  if (!g.messageId) return null;
  const channel = await resolveChannel(guild, g.channelId);
  if (!channel) return null;
  try {
    await channel.messages.edit(g.messageId, { embeds: [buildEmbed(g, guild)], ...(removeView ? { components: [] } : {}) });
    return g.messageId;
  } catch (err) {
    if (!isCode(err, RESTJSONErrorCodes.UnknownMessage)) log.warn(`Не удалось обновить сообщение розыгрыша #${g.id}`, err);
    return null;
  }
}

// Случайно выбирает победителей среди тех, кто ещё на сервере (и бустит, если это условие).
export async function draw(guild: Guild, g: Giveaway, count: number, exclude: ReadonlySet<string> = new Set()): Promise<string[]> {
  const rows = await prisma.giveawayEntry.findMany({ where: { giveawayId: g.id }, select: { userId: true } });
  const pool = rows.map((r) => r.userId).filter((id) => !exclude.has(id));
  // Перемешивание Фишера — Йетса на криптографически стойком генераторе.
  for (let i = pool.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [pool[i], pool[j]] = [pool[j]!, pool[i]!];
  }

  const winners: string[] = [];
  for (const id of pool) {
    if (winners.length >= count) break;
    let member: GuildMember | undefined = guild.members.cache.get(id);
    if (!member) {
      try {
        member = await guild.members.fetch(id);
      } catch (err) {
        if (!isCode(err, RESTJSONErrorCodes.UnknownMember)) log.warn(`Не удалось проверить участника ${id}`, err);
        continue; // ушёл с сервера
      }
    }
    if (g.boostersOnly && !member.premiumSince) continue; // перестал бустить
    winners.push(id);
  }
  return winners;
}

// --- промокоды ---

// Закрепляет свободные промокоды за победителями, по одному на каждого.
// reuseUndelivered — отдать и те, что не дошли прошлым победителям (для реролла).
export async function assignPromos(g: GiveawayFull, winners: string[], reuseUndelivered = false): Promise<GiveawayPromoCode[]> {
  if (!g.hasPromo || winners.length === 0) return [];
  const free = await prisma.giveawayPromoCode.findMany({
    where: { giveawayId: g.id, ...(reuseUndelivered ? { OR: [{ userId: null }, { dmSent: false }] } : { userId: null }) },
    orderBy: { id: "asc" },
  });
  // Сначала ни разу не выданные, потом недоставленные.
  free.sort((a, b) => Number(a.userId !== null) - Number(b.userId !== null) || a.id - b.id);

  const assigned: GiveawayPromoCode[] = [];
  for (const [i, userId] of winners.entries()) {
    const promo = free[i];
    if (!promo) break;
    assigned.push(await prisma.giveawayPromoCode.update({ where: { id: promo.id }, data: { userId, dmSent: false } }));
  }
  return assigned;
}

async function sendPromoDm(guild: Guild, g: Giveaway, promo: GiveawayPromoCode): Promise<boolean> {
  const { promoDmText } = await getSettings();
  const text = renderTemplate(promoDmText, { prize: g.prize, code: escapeMarkdown(promo.code) }).slice(0, 2000);
  try {
    const user = await guild.client.users.fetch(promo.userId!);
    await user.send({ content: text, flags: MessageFlags.SuppressEmbeds });
    return true;
  } catch (err) {
    log.warn(`Не удалось отправить промокод в ЛС пользователю ${promo.userId}`, err);
    return false;
  }
}

export async function sendPromos(guild: Guild, g: Giveaway, promos: GiveawayPromoCode[]): Promise<GiveawayPromoCode[]> {
  const result: GiveawayPromoCode[] = [];
  for (const promo of promos) {
    const sent = await sendPromoDm(guild, g, promo);
    result.push(await prisma.giveawayPromoCode.update({ where: { id: promo.id }, data: { dmSent: sent } }));
    // Сам промокод в историю не пишем: её видят все, у кого есть доступ к панели.
    if (sent) event("promo.sent", `Промокод розыгрыша #${g.id} отправлен победителю в ЛС`, { memberId: promo.userId, details: { giveawayId: g.id } });
    else event("promo.failed", `Промокод розыгрыша #${g.id} не дошёл: у победителя закрыты ЛС`, { level: "WARN", memberId: promo.userId, details: { giveawayId: g.id } });
  }
  return result;
}

export async function hasUndelivered(giveawayId: number): Promise<boolean> {
  return (await prisma.giveawayPromoCode.count({ where: { giveawayId, userId: { not: null }, dmSent: false } })) > 0;
}

// Кому какой промокод достался — видит только администрация.
export async function promoReport(g: Giveaway): Promise<string> {
  const codes = await prisma.giveawayPromoCode.findMany({ where: { giveawayId: g.id }, orderBy: { id: "asc" } });
  const lines = [`📋 Промокоды розыгрыша **${escapeMarkdown(g.prize)}** (#${g.id}):`];
  const unused: string[] = [];
  for (const p of codes) {
    if (p.userId === null) unused.push(`\`${p.code}\``);
    else if (p.dmSent) lines.push(`✅ <@${p.userId}> - \`${p.code}\``);
    else lines.push(`❌ <@${p.userId}> - \`${p.code}\` · не дошёл (закрыты ЛС)`);
  }
  if (unused.length > 0) lines.push(`🎟 Не выданы: ${unused.join(", ")}`);
  return lines.join("\n").slice(0, 2000);
}

async function reportToHost(guild: Guild, g: Giveaway): Promise<void> {
  try {
    const host = await guild.client.users.fetch(g.hostId);
    await host.send(await promoReport(g));
  } catch (err) {
    log.warn(`Не удалось отправить отчёт по промокодам организатору розыгрыша #${g.id}`, err);
  }
}

// --- итоги ---

export async function announce(
  guild: Guild,
  g: Giveaway,
  winners: string[],
  replyTo: string | null,
  promos: GiveawayPromoCode[],
  reroll = false,
): Promise<void> {
  const channel = await resolveChannel(guild, g.channelId);
  if (!channel) return;
  const prize = escapeMarkdown(g.prize);

  let text: string;
  if (reroll) {
    text = `🔁 Перевыбор в розыгрыше **${prize}**!\n${winners.length === 1 ? "Новый победитель" : "Новые победители"}: ${mentions(winners)}`;
  } else if (winners.length > 0) {
    text = `🎉 Поздравляем ${mentions(winners)} с победой в розыгрыше **${prize}**!`;
    if (winners.length < g.winnersCount) text += "\n-# Участников хватило не на все призы.";
  } else {
    text = `😔 Розыгрыш **${prize}** завершён, но победителей нет - не хватило участников.`;
  }

  const delivered = promos.filter((p) => p.dmSent);
  const failed = promos.filter((p) => !p.dmSent).map((p) => p.userId!);
  if (delivered.length > 0) text += `\n📩 ${delivered.length === 1 ? "Промокод отправлен" : "Промокоды отправлены"} в личные сообщения.`;
  if (failed.length > 0) {
    text += `\n⚠️ ${mentions(failed)}, не получилось отправить промокод - у тебя закрыты ЛС. Создать тикет для выдачи промокода.`;
  }

  try {
    await channel.send({
      content: text,
      reply: replyTo ? { messageReference: replyTo, failIfNotExists: false } : undefined,
      allowedMentions: { users: winners, roles: [], repliedUser: false },
    });
  } catch (err) {
    log.warn(`Не удалось отправить итоги розыгрыша #${g.id}`, err);
  }
}

// Подводит итоги. Возвращает завершённый розыгрыш или null, если он уже не активен.
export async function finish(guild: Guild, id: number, { notifyHost = true, byId = null as string | null } = {}): Promise<GiveawayFull | null> {
  const result = await withLock(`giveaway:${id}`, async () => {
    const g = await loadGiveaway({ id });
    if (!g || g.status !== "ACTIVE") return null;
    const winners = await draw(guild, g, g.winnersCount);
    const endedAt = new Date(Math.min(g.endsAt.getTime(), Date.now()));
    // Условие по статусу: если панель успела отменить розыгрыш, итоги не подводим.
    const { count } = await prisma.giveaway.updateMany({ where: { id, status: "ACTIVE" }, data: { status: "ENDED", winners, endsAt: endedAt } });
    if (count === 0) return null;
    const promos = await assignPromos(g, winners);
    return { g: (await loadGiveaway({ id }))!, winners, promos };
  });
  if (!result) return null;
  const { g, winners } = result;

  dirty.delete(g.id);
  const promos = await sendPromos(guild, g, result.promos);
  const messageId = await updateMessage(guild, g, true);
  await announce(guild, g, winners, messageId, promos);
  if (g.hasPromo && notifyHost) await reportToHost(guild, g);

  event(
    "giveaway.ended",
    winners.length > 0
      ? `Розыгрыш #${g.id} «${g.prize}» завершён: ${winners.length} из ${g.winnersCount} победителей, участников ${g.entryCount}`
      : `Розыгрыш #${g.id} «${g.prize}» завершён без победителей: не хватило участников`,
    { memberId: byId, details: { giveawayId: g.id, winners, entries: g.entryCount, early: byId !== null } },
  );
  log.info(`Розыгрыш #${g.id} завершён, победители: ${winners.join(", ") || "нет"}`);
  return g;
}

// Фоновая задача: подведение итогов, обновление счётчиков и сообщений, изменённых из панели.
export async function tick(guild: Guild): Promise<void> {
  const due = await prisma.giveaway.findMany({ where: { status: "ACTIVE", endsAt: { lte: new Date() } }, select: { id: true } });
  for (const { id } of due) {
    try {
      await finish(guild, id);
    } catch (err) {
      log.error(`Не удалось подвести итоги розыгрыша #${id}`, err);
    }
  }

  const flagged = await prisma.giveaway.findMany({ where: { needsMessageUpdate: true }, select: { id: true }, take: 20 });
  for (const { id } of flagged) {
    const g = await loadGiveaway({ id });
    if (g) await updateMessage(guild, g, g.status !== "ACTIVE");
    await prisma.giveaway.update({ where: { id }, data: { needsMessageUpdate: false } });
    dirty.delete(id);
  }

  const ids = [...dirty];
  dirty.clear();
  for (const id of ids) {
    const g = await loadGiveaway({ id });
    if (g?.status === "ACTIVE") await updateMessage(guild, g);
  }
}
