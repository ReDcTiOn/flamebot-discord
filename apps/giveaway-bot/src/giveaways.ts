import { randomBytes, randomInt } from "node:crypto";
import {
  ActionRowBuilder,
  AttachmentBuilder,
  ContainerBuilder,
  MediaGalleryBuilder,
  MediaGalleryItemBuilder,
  SeparatorBuilder,
  TextDisplayBuilder,
  ButtonBuilder,
  ButtonStyle,
  Colors,
  DiscordAPIError,
  MessageFlags,
  PermissionFlagsBits,
  RESTJSONErrorCodes,
  escapeMarkdown,
  type Guild,
  type GuildMember,
  type GuildTextBasedChannel,
  type MessageActionRowComponentBuilder,
} from "discord.js";
import { formatInZone, giveawayMessage, giveawayMessageConfig, nextGiveawayStart, plural, prisma, renderTemplate, type Giveaway, type GiveawayPromoCode } from "@flamebot/core";
import { createScheduledPromos, promoRetry } from "./balance-promos.js";
import { renderBanner } from "./banner.js";
import { event, log } from "./events.js";
import { giveawayPayload } from "./message-format.js";
import { getSettings, mentions, unix, withLock } from "./util.js";

export const JOIN_BUTTON_ID = "giveaway:join";
export const CLAIM_BUTTON_PREFIX = "giveaway:claim:";
// Фирменный оранжевый цвет Flame.
export const EMBED_COLOR = 0xff5a1f;

export type GiveawayFull = Giveaway & { hasPromo: boolean; entryCount: number };

// Розыгрыши, у которых надо обновить счётчик участников в сообщении.
const dirty = new Set<number>();

export function scheduleCountUpdate(guild: Guild, id: number) {
  if (dirty.has(id)) return;
  dirty.add(id);
  // Объединяем близкие нажатия, чтобы не загружать PNG при каждом из них.
  setTimeout(() => {
    if (dirty.delete(id)) {
      void updateMessage(guild, id, true).catch(() => {
        log.warn(`Не удалось обновить число участников розыгрыша #${id}`);
      });
    }
  }, 1000).unref();
}

export async function loadGiveaway(where: { id: number } | { messageId: string }): Promise<GiveawayFull | null> {
  const row = await prisma.giveaway.findUnique({ where, include: { _count: { select: { entries: true, promoCodes: true } } } });
  if (!row) return null;
  const { _count, ...g } = row;
  return { ...g, hasPromo: _count.promoCodes > 0, entryCount: _count.entries };
}

export const jumpUrl = (guildId: string, g: Giveaway) => `https://discord.com/channels/${guildId}/${g.channelId}/${g.messageId}`;

function joinRow(label: string) {
  return new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
    new ButtonBuilder().setCustomId(JOIN_BUTTON_ID).setLabel(label).setEmoji("🎉").setStyle(ButtonStyle.Primary),
  );
}

export async function buildGiveawayMessage(g: GiveawayFull, settings?: Awaited<ReturnType<typeof getSettings>>, publish = false) {
  const cfg = settings ?? await getSettings();
  const m = (key: Parameters<typeof giveawayMessage>[1], vars?: Record<string, string | number>) => giveawayMessage(cfg, key, vars);
  const text = (content: string) => new TextDisplayBuilder().setContent(content);
  const container = new ContainerBuilder().setAccentColor(
    g.status === "ACTIVE" ? EMBED_COLOR : g.status === "ENDED" ? 0x68cb9a : Colors.Red,
  );
  const files: AttachmentBuilder[] = [];
  if (g.status === "CANCELLED") {
    container.addTextDisplayComponents(text(m("cancelled", { prize: escapeMarkdown(g.prize) })));
  } else {
    const filename = "giveaway.png";
    files.push(new AttachmentBuilder(await renderBanner(g), { name: filename }));
    container.addMediaGalleryComponents(new MediaGalleryBuilder().addItems(
      new MediaGalleryItemBuilder().setURL(`attachment://${filename}`),
    ));
    if (g.description?.trim()) container.addTextDisplayComponents(text(g.description.slice(0, 1500).replace(/@(everyone|here)/g, "@\u200b$1")));
    container.addSeparatorComponents(new SeparatorBuilder());

    if (g.status === "ACTIVE") {
      const ends = unix(g.endsAt);
      const details = [
        m("endTime", { time: `<t:${ends}:F>`, relative: `<t:${ends}:R>` }),
        g.boostersOnly ? m("boosters") : "",
        g.hasPromo ? m("promoHint") : "",
      ].filter(Boolean).join("\n");
      if (details) container.addTextDisplayComponents(text(details));
      container.addActionRowComponents(joinRow(m("joinButton")));
    } else {
      const names = mentions(g.winners.slice(0, 40));
      const remaining = g.winners.length - 40;
      container.addTextDisplayComponents(text(m("winners", {
        winners: (names || m("noWinners")) + (remaining > 0 ? m("moreWinners", { count: remaining }) : ""),
      })));
      if (g.hasPromo && g.winners.length > 0) {
        const hint = m("claimHint");
        if (hint) container.addSeparatorComponents(new SeparatorBuilder()).addTextDisplayComponents(text(hint));
        container          .addActionRowComponents(new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
            new ButtonBuilder().setCustomId(`${CLAIM_BUTTON_PREFIX}${g.id}`).setLabel(m("claimButton")).setEmoji("🎟").setStyle(ButtonStyle.Primary),
          ));
      }
    }
  }
  const mention = g.status === "ACTIVE" ? m("everyone") : "";
  return {
    flags: MessageFlags.IsComponentsV2 as const,
    components: mention ? [text(mention), container] : [container],
    files,
    allowedMentions: { parse: publish && mention ? ["everyone" as const] : [], repliedUser: false },
  };
}

export async function sendGiveaway(channel: GuildTextBasedChannel, g: GiveawayFull) {
  const settings = await getSettings();
  const mention = giveawayMessage(settings, "everyone");
  const member = channel.guild.members.me;
  if (member && /@(everyone|here)\b/.test(mention) && !channel.permissionsFor(member)?.has(PermissionFlagsBits.MentionEveryone)) {
    log.warn(`Боту не хватает права «Упоминание @everyone» для розыгрыша #${g.id}`);
  }
  return channel.send({ ...await buildGiveawayMessage(g, settings, true), nonce: `giveaway:${g.id}`, enforceNonce: true });
}

const isCode = (err: unknown, code: number) => err instanceof DiscordAPIError && err.code === code;

// Каких прав не хватает боту, чтобы отправить розыгрыш в канал.
export function missingPermissions(channel: GuildTextBasedChannel): string[] {
  const me = channel.guild.members.me;
  const perms = me ? channel.permissionsFor(me) : null;
  return (
    [
      ["Просматривать канал", PermissionFlagsBits.ViewChannel],
      ["Отправлять сообщения", PermissionFlagsBits.SendMessages],
      ["Прикреплять файлы", PermissionFlagsBits.AttachFiles],
      ["Читать историю сообщений", PermissionFlagsBits.ReadMessageHistory],
    ] as const
  )
    .filter(([, flag]) => !perms?.has(flag))
    .map(([name]) => name);
}

export async function resolveChannel(guild: Guild, channelId: string): Promise<GuildTextBasedChannel | null> {
  const channel = guild.channels.cache.get(channelId) ?? (await guild.client.channels.fetch(channelId).catch(() => null));
  if (!channel || channel.isDMBased() || !channel.isTextBased() || channel.guildId !== guild.id) return null;
  return channel;
}

// Перечитываем запись под той же блокировкой, что и при подведении итогов.
export async function updateMessage(guild: Guild, id: number, activeOnly = false): Promise<string | null> {
  return withLock(`giveaway:${id}`, async () => {
    const g = await loadGiveaway({ id });
    if (!g?.messageId || (activeOnly && g.status !== "ACTIVE")) return null;
    const channel = await resolveChannel(guild, g.channelId);
    if (!channel) return null;
    try {
      await channel.messages.edit(g.messageId, {
        ...await buildGiveawayMessage(g),
        content: null,
        embeds: [],
        attachments: [],
      });
      return g.messageId;
    } catch (err) {
      if (!isCode(err, RESTJSONErrorCodes.UnknownMessage)) log.warn(`Не удалось обновить сообщение розыгрыша #${g.id}`, err);
      return null;
    }
  });
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
    where: { giveawayId: g.id, ...(reuseUndelivered ? { OR: [{ userId: null }, { dmSent: false, claimedAt: null }] } : { userId: null }) },
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
  const settings = await getSettings();
  const vars = { prize: escapeMarkdown(g.prize), code: escapeMarkdown(promo.code) };
  const text = giveawayMessage(settings, "dm", vars);
  if (!text) return false;
  try {
    const user = await guild.client.users.fetch(promo.userId!);
    const payload = giveawayPayload(settings, "dm", text, vars);
    // SuppressEmbeds прячет превью ссылок в обычном тексте, но спрятал бы и сам Embed: тогда ЛС пришло бы пустым.
    await user.send({ ...payload, ...("embeds" in payload ? {} : { flags: MessageFlags.SuppressEmbeds }), allowedMentions: { parse: [] } });
    return true;
  } catch {
    log.warn(`Не удалось отправить промокод в ЛС пользователю ${promo.userId}`);
    return false;
  }
}

export async function sendPromos(guild: Guild, g: Giveaway, promos: GiveawayPromoCode[]): Promise<GiveawayPromoCode[]> {
  if (!giveawayMessage(await getSettings(), "dm")) return [];
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
  if (!giveawayMessageConfig(await getSettings(), "dm").enabled) return false;
  return (await prisma.giveawayPromoCode.count({ where: { giveawayId, userId: { not: null }, dmSent: false, claimedAt: null } })) > 0;
}

// Кому какой промокод достался — видит только администрация.
export async function promoReport(g: Giveaway): Promise<string> {
  const codes = await prisma.giveawayPromoCode.findMany({ where: { giveawayId: g.id }, orderBy: { id: "asc" } });
  const settings = await getSettings();
  const lines = [renderTemplate(giveawayMessageConfig(settings, "organizer").text, { prize: escapeMarkdown(g.prize), id: g.id })];
  const unused: string[] = [];
  for (const p of codes) {
    if (p.userId === null) unused.push(`\`${p.code}\``);
    else if (p.claimedAt) lines.push(`✅ <@${p.userId}> · получен в канале · \`${p.code}\``);
    else if (p.dmSent) lines.push(`✅ <@${p.userId}> - \`${p.code}\``);
    else lines.push(`❌ <@${p.userId}> - \`${p.code}\` · не дошёл (закрыты ЛС)`);
  }
  if (unused.length > 0) lines.push(`🎟 Не выданы: ${unused.join(", ")}`);
  return lines.join("\n").slice(0, 2000);
}

async function reportToHost(guild: Guild, g: Giveaway): Promise<void> {
  try {
    const host = await guild.client.users.fetch(g.hostId);
    await host.send({ ...giveawayPayload(await getSettings(), "organizer", await promoReport(g), { prize: escapeMarkdown(g.prize), id: g.id }), allowedMentions: { parse: [] } });
  } catch (err) {
    log.warn(`Не удалось отправить отчёт по промокодам организатору розыгрыша #${g.id}`, err);
  }
}

// --- итоги ---

export async function announce(
  guild: Guild,
  g: GiveawayFull,
  winners: string[],
  replyTo: string | null,
  promos: GiveawayPromoCode[],
  reroll = false,
): Promise<void> {
  const channel = await resolveChannel(guild, g.channelId);
  if (!channel) return;
  const settings = await getSettings();
  const vars = { prize: escapeMarkdown(g.prize), winners: mentions(winners) };
  const key = reroll ? "reroll" : winners.length ? "congrats" : "empty";
  const delivered = promos.filter(p => p.dmSent);
  const failed = promos.filter(p => !p.dmSent).map(p => p.userId!);
  const text = [
    giveawayMessage(settings, key, vars),
    !reroll && winners.length > 0 && winners.length < g.winnersCount ? giveawayMessage(settings, "shortage") : "",
    delivered.length ? giveawayMessage(settings, "delivered") : "",
    failed.length ? giveawayMessage(settings, "failed", { winners: mentions(failed) }) : "",
  ].filter(Boolean).join("\n");

  try {
    if (!replyTo) {
      await channel.send(await buildGiveawayMessage(g));
    }
    if (!text) return;
    const member = channel.guild.members.me;
    const canEmbed = !member || !!channel.permissionsFor(member)?.has(PermissionFlagsBits.EmbedLinks);
    const mentioned = winners.filter(id => text.includes(`<@${id}>`));
    await channel.send({
      ...giveawayPayload(settings, key, text, vars, { canEmbed, mentionText: mentions(mentioned) || undefined }),
      reply: replyTo ? { messageReference: replyTo, failIfNotExists: false } : undefined,
      allowedMentions: { parse: [], users: winners, roles: [], repliedUser: false },
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
    const promos = await sendPromos(guild, g, await assignPromos(g, winners));
    return { g: (await loadGiveaway({ id }))!, winners, promos };
  });
  if (!result) return null;
  const { g, winners, promos } = result;

  dirty.delete(g.id);
  const messageId = await updateMessage(guild, g.id);
  await announce(guild, g, winners, messageId, promos);
  if (g.hasPromo && notifyHost && giveawayMessageConfig(await getSettings(), "organizer").enabled) await reportToHost(guild, g);

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

// Следующий экземпляр сохраняется в той же транзакции, что и исход публикации.
async function queueNextOccurrence(tx: Pick<typeof prisma, "giveaway">, g: Giveaway) {
  if (!g.startsAt || !g.repeatEveryDays || !g.repeatTimezone) return;
  const startsAt = nextGiveawayStart(g.startsAt, g.repeatEveryDays, g.repeatTimezone, new Date());
  const duration = g.endsAt.getTime() - g.startsAt.getTime();
  await tx.giveaway.create({
    data: {
      channelId: g.channelId,
      hostId: g.hostId,
      prize: g.prize,
      description: g.description,
      winnersCount: g.winnersCount,
      boostersOnly: g.boostersOnly,
      startsAt,
      endsAt: new Date(startsAt.getTime() + duration),
      repeatEveryDays: g.repeatEveryDays,
      repeatTimezone: g.repeatTimezone,
      repeatFromId: g.id,
      needsPublish: true,
      autoPromoAmount: g.autoPromoAmount,
      autoPromoSeed: g.autoPromoAmount !== null ? randomBytes(32).toString("hex") : null,
    },
  });
}

async function failPublish(g: Giveaway, reason: string): Promise<void> {
  const failed = await prisma.$transaction(async tx => {
    const result = await tx.giveaway.updateMany({
      where: { id: g.id, status: "ACTIVE", needsPublish: true },
      data: { status: "CANCELLED", needsPublish: false, publishError: reason, publishRetryAt: null },
    });
    if (result.count) await queueNextOccurrence(tx, g);
    return result.count > 0;
  });
  if (!failed) return;
  event("giveaway.publish_failed", `Розыгрыш #${g.id} «${g.prize}» не опубликован: ${reason}`, {
    level: "WARN",
    memberId: g.hostId,
    details: { giveawayId: g.id, channelId: g.channelId },
  });
}

// Публикует розыгрыши из панели и быстрые розыгрыши с готовыми промокодами.
async function publishPending(guild: Guild): Promise<void> {
  const now = new Date();
  const pending = await prisma.giveaway.findMany({
    where: { needsPublish: true, status: "ACTIVE", AND: [
      { OR: [{ startsAt: null }, { startsAt: { lte: now } }] },
      { OR: [{ publishRetryAt: null }, { publishRetryAt: { lte: now } }, { endsAt: { lte: now } }] },
    ] },
    orderBy: { id: "asc" },
    select: { id: true },
    take: 10,
  });
  for (const row of pending) {
    await withLock(`giveaway:${row.id}`, async () => {
      let g = await loadGiveaway({ id: row.id });
      if (!g || !g.needsPublish || g.status !== "ACTIVE") return;
      // Бот был выключен, и время итогов прошло раньше, чем розыгрыш успели показать участникам.
      if (g.endsAt.getTime() <= Date.now() + 60_000) return failPublish(g, "время итогов прошло раньше, чем бот успел отправить розыгрыш в канал");
      const channel = await resolveChannel(guild, g.channelId);
      if (!channel) return failPublish(g, "канал не найден или в него нельзя писать текстом");
      const missing = missingPermissions(channel);
      if (missing.length > 0) return failPublish(g, `боту не хватает прав в #${channel.name}: ${missing.join(", ")}`);

      if (g.autoPromoAmount !== null && g.autoPromoSeed && !g.hasPromo) {
        const { id, autoPromoSeed } = g;
        let codes: string[];
        try {
          codes = await createScheduledPromos(g.endsAt, g.winnersCount, g.autoPromoAmount, autoPromoSeed);
        } catch (err) {
          await prisma.giveaway.updateMany({
            where: { id, status: "ACTIVE", needsPublish: true },
            data: promoRetry(err),
          });
          return;
        }
        await prisma.$transaction(async (tx) => {
          const changed = await tx.giveaway.updateMany({
            where: { id, status: "ACTIVE", needsPublish: true, autoPromoSeed },
            data: { autoPromoSeed: null, publishError: null, publishRetryAt: null },
          });
          if (changed.count) await tx.giveawayPromoCode.createMany({ data: codes.map(code => ({ giveawayId: id, code })) });
        });
        g = await loadGiveaway({ id });
        if (!g || g.status !== "ACTIVE" || !g.needsPublish || !g.hasPromo) return;
      }

      if (g.endsAt.getTime() <= Date.now() + 60_000) return failPublish(g, "время итогов прошло раньше, чем бот успел отправить розыгрыш в канал");
      let messageId: string;
      try {
        messageId = (await sendGiveaway(channel, g)).id;
      } catch (err) {
        // Сбой Discord может быть временным: оставляем розыгрыш в очереди, бот попробует снова.
        await prisma.giveaway.update({ where: { id: g.id }, data: { publishError: "Discord не принял сообщение, бот попробует ещё раз", publishRetryAt: new Date(Date.now() + 30_000) } });
        log.warn(`Не удалось опубликовать розыгрыш #${g.id} из очереди`, err);
        return;
      }
      const completed = g;
      const published = await prisma.$transaction(async tx => {
        const result = await tx.giveaway.updateMany({
          where: { id: completed.id, status: "ACTIVE", needsPublish: true },
          data: { messageId, needsPublish: false, publishError: null, publishRetryAt: null },
        });
        if (result.count) await queueNextOccurrence(tx, completed);
        return result.count > 0;
      });
      if (!published) {
        await prisma.giveaway.updateMany({
          where: { id: g.id, status: "CANCELLED", messageId: null },
          data: { messageId, needsMessageUpdate: true },
        });
        return;
      }
      const { timezone } = await getSettings();
      event("giveaway.created", `Опубликован розыгрыш #${g.id} «${g.prize}» из очереди: ${g.winnersCount} ${plural(g.winnersCount, "победитель", "победителя", "победителей")}, итоги ${formatInZone(g.endsAt, timezone)}`, {
        memberId: g.hostId,
        details: { giveawayId: g.id, channelId: g.channelId, winners: g.winnersCount, endsAt: g.endsAt.toISOString(), boostersOnly: g.boostersOnly },
      });
    });
  }
}

export async function tick(guild: Guild): Promise<void> {
  await publishPending(guild);

  // Неопубликованные розыгрыши не подводим: их ещё никто не видел.
  const due = await prisma.giveaway.findMany({ where: { status: "ACTIVE", needsPublish: false, endsAt: { lte: new Date() } }, select: { id: true } });
  for (const { id } of due) {
    try {
      await finish(guild, id);
    } catch (err) {
      log.error(`Не удалось подвести итоги розыгрыша #${id}`, err);
    }
  }

  const flagged = await prisma.giveaway.findMany({ where: { needsMessageUpdate: true }, select: { id: true }, take: 20 });
  if (flagged.length) await getSettings(true);
  for (const { id } of flagged) {
    dirty.delete(id);
    const g = await loadGiveaway({ id });
    if (g) await updateMessage(guild, g.id);
    await prisma.giveaway.update({ where: { id }, data: { needsMessageUpdate: false } });
  }

  const ids = [...dirty];
  dirty.clear();
  for (const id of ids) {
    await updateMessage(guild, id, true);
  }
}
