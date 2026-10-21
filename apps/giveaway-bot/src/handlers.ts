import { randomBytes } from "node:crypto";
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  EmbedBuilder,
  MessageFlags,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  escapeMarkdown,
  type AutocompleteInteraction,
  type ButtonInteraction,
  type ChatInputCommandInteraction,
  type GuildBasedChannel,
  type Interaction,
  type MessageActionRowComponentBuilder,
  type ModalSubmitInteraction,
  type NewsChannel,
  type RepliableInteraction,
  type TextChannel,
} from "discord.js";
import {
  GIVEAWAY_MAX_DAYS,
  addDays,
  compareDates,
  formatDate,
  formatInZone,
  formatTime,
  parseCodes,
  parseDate,
  parseTime,
  plural,
  prisma,
  promoCodesProblem,
  today as todayIn,
  weekday,
  zonedParts,
  zonedToDate,
  type GiveawayStatus,
} from "@flamebot/core";
import { COMMAND_NAME } from "./commands.js";
import { config } from "./config.js";
import { event, log } from "./events.js";
import {
  JOIN_BUTTON_ID,
  EMBED_COLOR,
  announce,
  assignPromos,
  buildEmbed,
  dirty,
  draw,
  finish,
  hasUndelivered,
  joinRow,
  jumpUrl,
  loadGiveaway,
  missingPermissions,
  promoReport,
  sendPromos,
  updateMessage,
} from "./giveaways.js";
import { RateLimiter, getSettings, mentions, unix, withLock } from "./util.js";

const WEEKDAYS = ["пн", "вт", "ср", "чт", "пт", "сб", "вс"];
const DAY_MS = 86_400_000;

// Параметры розыгрыша между командой и окном ввода промокодов.
interface Draft {
  hostId: string;
  prize: string;
  winners: number;
  endsAt: Date;
  boostersOnly: boolean;
  channelId: string;
  description: string | null;
  // Что было введено в окне в прошлый раз — чтобы исправить, а не вставлять заново.
  previous: string;
  expiresAt: number;
}

const DRAFT_TTL_MS = 15 * 60_000;
const drafts = new Map<string, Draft>();

function saveDraft(d: Omit<Draft, "previous" | "expiresAt">): string {
  const now = Date.now();
  for (const [k, v] of drafts) if (v.expiresAt < now) drafts.delete(k);
  const id = randomBytes(8).toString("hex");
  drafts.set(id, { ...d, previous: "", expiresAt: now + DRAFT_TTL_MS });
  return id;
}

const ephemeral = MessageFlags.Ephemeral;

async function error(interaction: RepliableInteraction, text: string) {
  const payload = { content: `⚠️ ${text}`, flags: ephemeral } as const;
  if (interaction.deferred || interaction.replied) await interaction.followUp(payload);
  else await interaction.reply(payload);
}

function resendRow(giveawayId: number) {
  return new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
    new ButtonBuilder().setCustomId(`giveaway:resend:${giveawayId}`).setLabel("Отправить недоставленные ещё раз").setEmoji("📩").setStyle(ButtonStyle.Primary),
  );
}

// Кнопка повторной отправки — только если есть промокоды, которые не дошли.
async function resendComponents(giveawayId: number) {
  return (await hasUndelivered(giveawayId)) ? [resendRow(giveawayId)] : [];
}

function promoModal(draftId: string, d: Draft) {
  const n = d.winners;
  const input = new TextInputBuilder()
    .setCustomId("codes")
    .setLabel(`${n} ${plural(n, "промокод", "промокода", "промокодов")}, по одному в строке`)
    .setStyle(TextInputStyle.Paragraph)
    .setPlaceholder("PROMO-AAAAAAAAAA\nPROMO-BBBBBBBBBB")
    .setMaxLength(4000)
    .setRequired(true);
  if (d.previous) input.setValue(d.previous);
  return new ModalBuilder()
    .setCustomId(`giveaway:promo:${draftId}`)
    .setTitle("Промокоды для победителей")
    .addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(input));
}

// Проверяет, что в канал можно отправить розыгрыш. Если нет — отвечает ошибкой и возвращает null.
async function checkChannel(interaction: RepliableInteraction<"cached">, target: GuildBasedChannel | null): Promise<TextChannel | NewsChannel | null> {
  if (!target || (target.type !== ChannelType.GuildText && target.type !== ChannelType.GuildAnnouncement)) {
    await error(interaction, "Здесь нельзя создать розыгрыш - укажи текстовый канал в параметре «канал».");
    return null;
  }
  const missing = missingPermissions(target);
  if (missing.length > 0) {
    await error(interaction, `У бота не хватает прав в ${target.toString()}: ${missing.join(", ")}.`);
    return null;
  }
  return target;
}

// Отправляет розыгрыш в канал. Вызывается сразу из команды или после окна с промокодами.
async function publish(interaction: ChatInputCommandInteraction<"cached"> | ModalSubmitInteraction<"cached">, d: Draft, codes: string[]) {
  const s = await getSettings();
  if (d.endsAt.getTime() <= Date.now()) {
    await error(interaction, "Пока вводились промокоды, время итогов уже прошло. Создай розыгрыш заново.");
    return;
  }
  const channel = await checkChannel(interaction, interaction.guild.channels.cache.get(d.channelId) ?? null);
  if (!channel) return;

  await interaction.deferReply({ flags: ephemeral });
  const created = await prisma.giveaway.create({
    data: {
      channelId: channel.id,
      hostId: d.hostId,
      prize: d.prize,
      description: d.description,
      winnersCount: d.winners,
      endsAt: d.endsAt,
      boostersOnly: d.boostersOnly,
      promoCodes: { create: codes.map((code) => ({ code })) },
    },
  });
  const g = (await loadGiveaway({ id: created.id }))!;

  let messageUrl: string;
  try {
    const message = await channel.send({ embeds: [buildEmbed(g, interaction.guild)], components: [joinRow()] });
    await prisma.giveaway.update({ where: { id: g.id }, data: { messageId: message.id } });
    messageUrl = message.url;
  } catch (err) {
    await prisma.giveaway.delete({ where: { id: g.id } });
    log.error("Не удалось отправить сообщение розыгрыша", err);
    await interaction.editReply("⚠️ Не удалось отправить сообщение розыгрыша.");
    return;
  }

  let text = `✅ Розыгрыш **#${g.id}** создан: ${messageUrl}\nИтоги: **${formatInZone(d.endsAt, s.timezone)}** (${s.timezoneLabel})`;
  if (d.boostersOnly) text += "\n🚀 Только для бустеров";
  if (codes.length > 0) text += `\n🎟 Промокодов загружено: ${codes.length}. После итогов пришлю тебе в ЛС, кому какой достался.`;
  await interaction.editReply(text);

  event("giveaway.created", `Создан розыгрыш #${g.id} «${g.prize}»: ${g.winnersCount} ${plural(g.winnersCount, "победитель", "победителя", "победителей")}, итоги ${formatInZone(d.endsAt, s.timezone)}`, {
    memberId: d.hostId,
    details: { giveawayId: g.id, channelId: channel.id, winners: g.winnersCount, endsAt: d.endsAt.toISOString(), boostersOnly: d.boostersOnly, promoCodes: codes.length },
  });
}

// --- команды ---

async function create(interaction: ChatInputCommandInteraction<"cached">) {
  const s = await getSettings();
  const o = interaction.options;
  const now = new Date();
  const dateText = o.getString("дата", true);
  const timeText = o.getString("время", true);

  const date = parseDate(dateText, todayIn(s.timezone, now));
  if (!date) return error(interaction, `Не понял дату «${dateText}». Формат: ДД.ММ.ГГГГ, например 30.09.2026`);
  const time = parseTime(timeText);
  if (!time) return error(interaction, `Не понял время «${timeText}». Формат: ЧЧ:ММ, например 20:00`);

  const endsAt = zonedToDate(date, time, s.timezone);
  if (endsAt.getTime() <= now.getTime() + 60_000) {
    return error(interaction, `Время итогов должно быть в будущем. Сейчас ${formatInZone(now, s.timezone)} (${s.timezoneLabel}).`);
  }
  if (endsAt.getTime() - now.getTime() > GIVEAWAY_MAX_DAYS * DAY_MS) return error(interaction, "Розыгрыш не может длиться дольше года.");

  const target = await checkChannel(interaction, o.getChannel("канал") ?? interaction.channel);
  if (!target) return;

  const draft = {
    hostId: interaction.user.id,
    prize: o.getString("приз", true),
    winners: o.getInteger("количество", true),
    endsAt,
    boostersOnly: o.getBoolean("только_бустеры") ?? false,
    channelId: target.id,
    description: o.getString("описание"),
  };
  if (o.getBoolean("промокоды")) {
    const id = saveDraft(draft);
    await interaction.showModal(promoModal(id, drafts.get(id)!));
  } else {
    await publish(interaction, { ...draft, previous: "", expiresAt: 0 }, []);
  }
}

async function quick(interaction: ChatInputCommandInteraction<"cached">) {
  const s = await getSettings();
  const target = await checkChannel(interaction, interaction.channel);
  if (!target) return;
  const day = addDays(todayIn(s.timezone), s.quickDaysAhead);
  const endsAt = zonedToDate(day, parseTime(s.quickTime) ?? { hour: 23, minute: 0 }, s.timezone);
  if (endsAt.getTime() <= Date.now() + 60_000) {
    return error(interaction, `Время итогов быстрого розыгрыша (${formatInZone(endsAt, s.timezone)}) уже прошло. Поменяй его в панели или создай розыгрыш через «создать».`);
  }
  const id = saveDraft({
    hostId: interaction.user.id,
    prize: s.quickPrize,
    winners: s.quickWinners,
    endsAt,
    boostersOnly: s.quickBoostersOnly,
    channelId: target.id,
    description: null,
  });
  await interaction.showModal(promoModal(id, drafts.get(id)!));
}

async function end(interaction: ChatInputCommandInteraction<"cached">) {
  const id = interaction.options.getInteger("розыгрыш", true);
  const g = await loadGiveaway({ id });
  if (!g || g.status !== "ACTIVE") return error(interaction, "Активный розыгрыш с таким номером не найден.");
  if (g.needsPublish) return error(interaction, "Этот розыгрыш создан в панели и ещё не опубликован в канале.");
  await interaction.deferReply({ flags: ephemeral });
  const done = await finish(interaction.guild, g.id, { notifyHost: false, byId: interaction.user.id });
  if (!done) {
    await interaction.editReply("Этот розыгрыш уже завершён.");
    return;
  }
  let text = `🏁 Розыгрыш **#${done.id}** завершён. Победители: ${mentions(done.winners) || "никого"}`;
  if (done.hasPromo) text += `\n\n${await promoReport(done)}`;
  await interaction.editReply({ content: text.slice(0, 2000), components: await resendComponents(done.id) });
}

async function reroll(interaction: ChatInputCommandInteraction<"cached">) {
  const id = interaction.options.getInteger("розыгрыш", true);
  const count = interaction.options.getInteger("количество") ?? 1;
  const before = await loadGiveaway({ id });
  if (!before || before.status !== "ENDED") return error(interaction, "Завершённый розыгрыш с таким номером не найден.");
  await interaction.deferReply({ flags: ephemeral });

  const result = await withLock(`giveaway:${id}`, async () => {
    const g = (await loadGiveaway({ id }))!;
    const fresh = await draw(interaction.guild, g, count, new Set(g.winners));
    if (fresh.length === 0) return null;
    await prisma.giveaway.update({ where: { id }, data: { winners: [...g.winners, ...fresh] } });
    // Новым победителям достаются невыданные промокоды и те, что не дошли прошлым победителям.
    return { g, fresh, promos: await assignPromos(g, fresh, true) };
  });
  if (!result) {
    await interaction.editReply("Выбрать некого - все подходящие участники уже побеждали.");
    return;
  }

  const { g, fresh } = result;
  const promos = await sendPromos(interaction.guild, g, result.promos);
  await announce(interaction.guild, g, fresh, g.messageId, promos, true);
  event("giveaway.reroll", `Реролл розыгрыша #${g.id} «${g.prize}»: ${fresh.length} ${plural(fresh.length, "новый победитель", "новых победителя", "новых победителей")}`, {
    memberId: interaction.user.id,
    details: { giveawayId: g.id, winners: fresh },
  });

  let text = `🔁 Новые победители: ${mentions(fresh)}`;
  if (g.hasPromo) {
    if (promos.length < fresh.length) text += "\n⚠️ Свободных промокодов не хватило - часть победителей осталась без промокода.";
    text += `\n\n${await promoReport(g)}`;
  }
  await interaction.editReply({ content: text.slice(0, 2000), components: await resendComponents(g.id) });
}

async function promoCodes(interaction: ChatInputCommandInteraction<"cached">) {
  const g = await loadGiveaway({ id: interaction.options.getInteger("розыгрыш", true) });
  if (!g || !g.hasPromo) return error(interaction, "Розыгрыш с промокодами с таким номером не найден.");
  await interaction.reply({ content: await promoReport(g), components: await resendComponents(g.id), flags: ephemeral });
}

async function cancel(interaction: ChatInputCommandInteraction<"cached">) {
  const id = interaction.options.getInteger("розыгрыш", true);
  const g = await withLock(`giveaway:${id}`, async () => {
    const { count } = await prisma.giveaway.updateMany({ where: { id, status: "ACTIVE" }, data: { status: "CANCELLED" } });
    return count > 0 ? loadGiveaway({ id }) : null;
  });
  if (!g) return error(interaction, "Активный розыгрыш с таким номером не найден.");
  await interaction.deferReply({ flags: ephemeral });
  await updateMessage(interaction.guild, g, true);
  dirty.delete(g.id);
  event("giveaway.cancelled", `Розыгрыш #${g.id} «${g.prize}» отменён`, { level: "WARN", memberId: interaction.user.id, details: { giveawayId: g.id } });
  await interaction.editReply(`❌ Розыгрыш **#${g.id}** (${escapeMarkdown(g.prize)}) отменён.`);
}

async function list(interaction: ChatInputCommandInteraction<"cached">) {
  const items = await prisma.giveaway.findMany({
    where: { status: "ACTIVE", needsPublish: false },
    orderBy: { endsAt: "asc" },
    take: 25,
    include: { _count: { select: { entries: true, promoCodes: true } } },
  });
  if (items.length === 0) {
    await interaction.reply({ content: "Активных розыгрышей нет.", flags: ephemeral });
    return;
  }
  const lines = items.map((g) => {
    const n = g._count.entries;
    const tags = (g.boostersOnly ? " · 🚀" : "") + (g._count.promoCodes > 0 ? " · 🎟" : "");
    return (
      `**#${g.id}** · [${escapeMarkdown(g.prize)}](${jumpUrl(interaction.guildId, g)})${tags}\n` +
      `└ ${g.winnersCount} ${plural(g.winnersCount, "победитель", "победителя", "победителей")}, ` +
      `${n} ${plural(n, "участник", "участника", "участников")}, итоги <t:${unix(g.endsAt)}:R>`
    );
  });
  const embed = new EmbedBuilder()
    .setTitle("🎁 Активные розыгрыши")
    .setDescription(lines.join("\n").slice(0, 4000))
    .setColor(EMBED_COLOR)
    .setFooter({ text: "🚀 - только бустеры · 🎟 - с промокодами" });
  await interaction.reply({ embeds: [embed], flags: ephemeral });
}

const SUBCOMMANDS: Record<string, (i: ChatInputCommandInteraction<"cached">) => Promise<unknown>> = {
  создать: create,
  быстрый: quick,
  завершить: end,
  реролл: reroll,
  промокоды: promoCodes,
  отменить: cancel,
  список: list,
};

// --- кнопки и окна ---

async function join(interaction: ButtonInteraction<"cached">) {
  const g = await loadGiveaway({ messageId: interaction.message.id });
  if (!g || g.status !== "ACTIVE") {
    await interaction.reply({ content: "Этот розыгрыш уже завершён.", flags: ephemeral });
    return;
  }
  if (g.endsAt.getTime() <= Date.now()) {
    await interaction.reply({ content: "Приём заявок закрыт - подводим итоги.", flags: ephemeral });
    return;
  }
  if (g.boostersOnly && !interaction.member.premiumSince) {
    await interaction.reply({
      content: `🚀 Этот розыгрыш только для тех, кто бустит сервер.\nЗабусти **${escapeMarkdown(interaction.guild.name)}** и возвращайся!`,
      flags: ephemeral,
    });
    return;
  }

  const prize = escapeMarkdown(g.prize);
  const { count } = await prisma.giveawayEntry.createMany({ data: [{ giveawayId: g.id, userId: interaction.user.id }], skipDuplicates: true });
  if (count === 0) {
    await interaction.reply({
      content: `Ты уже участвуешь в розыгрыше **${prize}**. Итоги <t:${unix(g.endsAt)}:R>.`,
      components: [
        new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
          new ButtonBuilder().setCustomId(`giveaway:leave:${g.id}`).setLabel("Покинуть розыгрыш").setStyle(ButtonStyle.Danger),
        ),
      ],
      flags: ephemeral,
    });
    return;
  }

  dirty.add(g.id);
  let text = `✅ Ты участвуешь в розыгрыше **${prize}**! Итоги <t:${unix(g.endsAt)}:R>. Удачи!`;
  if (g.hasPromo) text += "\n📩 Если победишь, промокод придёт в личные сообщения - проверь, что они открыты.";
  await interaction.reply({ content: text, flags: ephemeral });
}

async function leave(interaction: ButtonInteraction<"cached">, id: number) {
  const g = await loadGiveaway({ id });
  if (!g || g.status !== "ACTIVE") {
    await interaction.update({ content: "Этот розыгрыш уже завершён.", components: [] });
    return;
  }
  await prisma.giveawayEntry.deleteMany({ where: { giveawayId: g.id, userId: interaction.user.id } });
  dirty.add(g.id);
  await interaction.update({ content: `Ты больше не участвуешь в розыгрыше **${escapeMarkdown(g.prize)}**.`, components: [] });
}

async function resend(interaction: ButtonInteraction<"cached">, id: number) {
  const g = await loadGiveaway({ id });
  if (!g) return error(interaction, "Розыгрыш не найден.");
  await interaction.deferUpdate();
  const undelivered = await prisma.giveawayPromoCode.findMany({ where: { giveawayId: id, userId: { not: null }, dmSent: false }, orderBy: { id: "asc" } });
  await sendPromos(interaction.guild, g, undelivered);
  await interaction.editReply({ content: await promoReport(g), components: await resendComponents(id) });
}

async function submitPromo(interaction: ModalSubmitInteraction<"cached">, draftId: string) {
  const d = drafts.get(draftId);
  if (!d || d.hostId !== interaction.user.id || d.expiresAt < Date.now()) {
    return error(interaction, "Окно устарело. Создай розыгрыш заново.");
  }
  d.previous = interaction.fields.getTextInputValue("codes");
  const codes = parseCodes(d.previous);
  const problem = promoCodesProblem(codes, d.winners);
  if (problem) {
    await interaction.reply({
      content: `⚠️ ${problem}`,
      components: [
        new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
          new ButtonBuilder().setCustomId(`giveaway:retry:${draftId}`).setLabel("Исправить промокоды").setEmoji("✏️").setStyle(ButtonStyle.Primary),
        ),
      ],
      flags: ephemeral,
    });
    return;
  }
  drafts.delete(draftId);
  await publish(interaction, d, codes);
}

async function retry(interaction: ButtonInteraction<"cached">, draftId: string) {
  const d = drafts.get(draftId);
  if (!d || d.hostId !== interaction.user.id || d.expiresAt < Date.now()) return error(interaction, "Окно устарело. Создай розыгрыш заново.");
  await interaction.showModal(promoModal(draftId, d));
}

// --- автодополнение ---

async function dateChoices(current: string) {
  const s = await getSettings();
  const t0 = todayIn(s.timezone);
  const label = (d: ReturnType<typeof addDays>) => {
    const diff = Math.round((Date.UTC(d.year, d.month - 1, d.day) - Date.UTC(t0.year, t0.month - 1, t0.day)) / DAY_MS);
    const prefix = ["Сегодня · ", "Завтра · ", "Послезавтра · "][diff] ?? "";
    return `${prefix}${formatDate(d)}, ${WEEKDAYS[weekday(d)]}`;
  };

  const choices: { name: string; value: string }[] = [];
  const typed = current ? parseDate(current, t0) : null;
  if (typed && compareDates(typed, t0) >= 0) choices.push({ name: label(typed), value: formatDate(typed) });
  const query = current.trim().toLowerCase();
  for (let i = 0; i < 60 && choices.length < 25; i++) {
    const d = addDays(t0, i);
    if (typed && compareDates(d, typed) === 0) continue;
    const name = label(d);
    if (!query || name.toLowerCase().includes(query)) choices.push({ name, value: formatDate(d) });
  }
  return choices.slice(0, 25);
}

async function timeChoices(current: string, dateText: string | null) {
  const s = await getSettings();
  const cur = current.trim();
  let options: string[] = [];
  const typed = cur.length >= 3 ? parseTime(cur) : null;
  if (typed) options.push(formatTime(typed));
  if (cur) {
    for (let h = 0; h < 24; h++) {
      for (const m of [0, 15, 30, 45]) {
        const slot = formatTime({ hour: h, minute: m });
        if (slot.startsWith(cur) || slot.startsWith(`0${cur}`)) options.push(slot);
      }
    }
  } else {
    for (let h = 0; h < 24; h++) options.push(formatTime({ hour: h, minute: 0 }));
  }

  // Если выбрана сегодняшняя дата — не предлагаем уже прошедшее время.
  const now = zonedParts(new Date(), s.timezone);
  const picked = dateText ? parseDate(dateText, now) : null;
  if (picked && compareDates(picked, now) === 0) options = options.filter((o) => o > formatTime(now));

  return [...new Set(options)].slice(0, 25).map((o) => ({ name: `${o} (${s.timezoneLabel})`, value: o }));
}

async function giveawayChoices(current: string, status: GiveawayStatus, promoOnly = false) {
  const s = await getSettings();
  const rows = await prisma.giveaway.findMany({
    where: { status, needsPublish: false, ...(promoOnly ? { promoCodes: { some: {} } } : {}) },
    orderBy: { endsAt: status === "ACTIVE" ? "asc" : "desc" },
    take: 100,
  });
  const query = current.toLowerCase();
  return rows
    .map((g) => {
      const at = formatInZone(g.endsAt, s.timezone);
      return { name: `#${g.id} · ${g.prize.slice(0, 70)} · ${at.slice(0, 5)}${at.slice(10)}`, value: g.id };
    })
    .filter((c) => c.name.toLowerCase().includes(query))
    .slice(0, 25);
}

async function autocompleteChoices(interaction: AutocompleteInteraction<"cached">): Promise<{ name: string; value: string | number }[]> {
  const focused = interaction.options.getFocused(true);
  const value = String(focused.value);
  const sub = interaction.options.getSubcommand(false);
  let choices: { name: string; value: string | number }[] = [];
  if (focused.name === "дата") choices = await dateChoices(value);
  else if (focused.name === "время") choices = await timeChoices(value, interaction.options.getString("дата"));
  else if (focused.name === "розыгрыш") {
    if (sub === "реролл") choices = await giveawayChoices(value, "ENDED");
    else if (sub === "промокоды") choices = await giveawayChoices(value, "ENDED", true);
    else choices = await giveawayChoices(value, "ACTIVE");
  }
  return choices;
}

// --- маршрутизация ---

// Не больше 5 действий за 10 секунд от одного человека.
const limiter = new RateLimiter(5, 10_000);

async function safeError(interaction: RepliableInteraction) {
  try {
    await error(interaction, "Что-то пошло не так. Подробности в истории бота в панели.");
  } catch {
    // Взаимодействие могло истечь, тут уже ничего не сделать.
  }
}

export async function handleInteraction(interaction: Interaction): Promise<void> {
  if (!interaction.inCachedGuild() || interaction.guildId !== config.GUILD_ID) return;

  if (interaction.isAutocomplete()) {
    if (interaction.commandName !== COMMAND_NAME) return;
    // Ошибка автодополнения не должна ронять обработчик: тогда просто пустой список.
    const choices = await autocompleteChoices(interaction).catch((err) => {
      log.warn("Ошибка автодополнения", err);
      return [];
    });
    await interaction.respond(choices).catch(() => undefined);
    return;
  }
  if (!interaction.isRepliable()) return;

  if (!limiter.take(interaction.user.id)) {
    await interaction.reply({ content: "Слишком часто. Подожди пару секунд.", flags: ephemeral }).catch(() => undefined);
    return;
  }

  try {
    if (interaction.isChatInputCommand()) {
      // Кому доступна команда, решает Discord: по умолчанию тем, у кого есть «Управлять сервером»,
      // а в настройках интеграций сервера её можно открыть и другим ролям.
      if (interaction.commandName !== COMMAND_NAME) return;
      await SUBCOMMANDS[interaction.options.getSubcommand()]?.(interaction);
      return;
    }

    if (interaction.isButton()) {
      if (interaction.customId === JOIN_BUTTON_ID) return join(interaction);
      const [, action, arg = ""] = interaction.customId.split(":");
      if (action === "leave") return leave(interaction, Number(arg));
      // Остальные кнопки — в ответах админу. Ответы и так видны только ему, но проверяем автора команды.
      const owner = interaction.message.interactionMetadata?.user.id;
      if (owner && owner !== interaction.user.id) return error(interaction, "Это меню открыл другой человек.");
      if (action === "resend") return resend(interaction, Number(arg));
      if (action === "retry") return retry(interaction, arg);
      return;
    }

    if (interaction.isModalSubmit()) {
      const [, action, arg = ""] = interaction.customId.split(":");
      if (action === "promo") await submitPromo(interaction, arg);
    }
  } catch (err) {
    log.error("Ошибка обработки взаимодействия", err);
    await safeError(interaction);
  }
}
