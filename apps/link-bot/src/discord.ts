import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  DiscordAPIError,
  EmbedBuilder,
  MessageFlags,
  ModalBuilder,
  PermissionFlagsBits,
  TextInputBuilder,
  TextInputStyle,
  escapeMarkdown,
  type ButtonInteraction,
  type Guild,
  type GuildMember,
  type Interaction,
  type MessageActionRowComponentBuilder,
  type ModalSubmitInteraction,
  type RepliableInteraction,
} from "discord.js";
import { LINK_CODE_LENGTH, Prisma, checkRoleSafeToGrant, normalizeLinkCode, prisma, steamProfileUrl, type SteamLink } from "@flamebot/core";
import { config } from "./config.js";
import { event, log } from "./events.js";
import { RateLimiter, getSettings, unix } from "./util.js";

const BUTTON_ID = "link:start";
const MODAL_ID = "link:modal";
const EMBED_COLOR = 0x66c0f4;
const ephemeral = MessageFlags.Ephemeral;

// Не больше 5 нажатий за 10 секунд от одного человека.
const limiter = new RateLimiter(5, 10_000);
// Подбирать код бессмысленно: после 5 неверных кодов за 10 минут форма закрывается.
const wrongCodes = new RateLimiter(5, 10 * 60_000);

const isUnknown = (err: unknown, code: number) => err instanceof DiscordAPIError && err.code === code;

// --- роль за привязку ---

// Роль проверяется по живым данным Discord: та же проверка, что в панели, плюс место бота в списке ролей.
function grantableRole(guild: Guild, roleId: string): { ok: true } | { ok: false; reason: string } {
  const role = guild.roles.cache.get(roleId);
  const check = checkRoleSafeToGrant(role ? { id: role.id, permissions: role.permissions.bitfield, managed: role.managed } : null, guild.id);
  if (!check.ok) return check;
  if (!role!.editable) return { ok: false, reason: `Роль «${role!.name}» выше роли бота или у бота нет права «Управлять ролями»` };
  return { ok: true };
}

// true — роль у человека есть (или роль не настроена), false — выдать не получилось.
async function ensureRole(member: GuildMember, roleId: string | null): Promise<boolean> {
  if (!roleId || member.roles.cache.has(roleId)) return true;
  const check = grantableRole(member.guild, roleId);
  if (!check.ok) {
    log.warn(`Не могу выдать роль за привязку: ${check.reason}`);
    return false;
  }
  try {
    await member.roles.add(roleId, "Привязка Steam");
    event("role.granted", `${member.user.username} получил роль за привязку Steam`, { memberId: member.id, details: { roleId } });
    return true;
  } catch (err) {
    log.warn(`Не удалось выдать роль за привязку ${member.user.username}`, err);
    return false;
  }
}

async function fetchMember(guild: Guild, id: string): Promise<GuildMember | null> {
  try {
    return await guild.members.fetch({ user: id, force: true });
  } catch (err) {
    if (isUnknown(err, 10007) || isUnknown(err, 10013)) return null;
    throw err;
  }
}

// --- сообщение с кнопкой в канале ---

function panelPayload(s: { panelTitle: string; panelText: string; buttonLabel: string }) {
  const embed = new EmbedBuilder().setTitle(s.panelTitle).setDescription(s.panelText).setColor(EMBED_COLOR);
  const row = new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
    new ButtonBuilder().setCustomId(BUTTON_ID).setLabel(s.buttonLabel).setEmoji("🔗").setStyle(ButtonStyle.Primary),
  );
  return { embeds: [embed], components: [row] };
}

let lastPanel = "";

// Держит в выбранном канале одно сообщение с кнопкой: отправляет, обновляет после правки в панели,
// переносит при смене канала и отправляет заново, если его удалили.
export async function syncPanelMessage(guild: Guild): Promise<void> {
  const s = await prisma.linkSettings.findUnique({ where: { id: 1 } });
  if (!s) return;

  if (s.messageId && s.messageChannelId && s.messageChannelId !== s.channelId) {
    const old = guild.channels.cache.get(s.messageChannelId);
    if (old?.isTextBased()) await old.messages.delete(s.messageId).catch(() => undefined);
    await prisma.linkSettings.update({ where: { id: 1 }, data: { messageId: null, messageChannelId: null } });
    s.messageId = null;
    lastPanel = "";
    event("panel.moved", "Сообщение с кнопкой «Привязать» убрано из прежнего канала");
  }
  if (!s.channelId) return;

  const channel = guild.channels.cache.get(s.channelId);
  if (!channel || (channel.type !== ChannelType.GuildText && channel.type !== ChannelType.GuildAnnouncement)) {
    log.warn("Канал для сообщения с кнопкой «Привязать» не найден или это не текстовый канал. Выбери другой в панели.");
    return;
  }
  const missing = channel.permissionsFor(guild.members.me!)?.missing([
    PermissionFlagsBits.ViewChannel,
    PermissionFlagsBits.SendMessages,
    PermissionFlagsBits.EmbedLinks,
  ]);
  if (missing && missing.length > 0) {
    log.warn(`У бота привязки не хватает прав в #${channel.name}: ${missing.join(", ")}`);
    return;
  }

  const payload = panelPayload(s);
  const signature = JSON.stringify([channel.id, s.messageId, s.panelTitle, s.panelText, s.buttonLabel]);
  if (s.messageId) {
    if (signature === lastPanel) return;
    try {
      await channel.messages.edit(s.messageId, payload);
      lastPanel = signature;
      return;
    } catch (err) {
      // Сообщение удалили — отправим новое. Другие ошибки повторим в следующий раз.
      if (!isUnknown(err, 10008)) throw err;
    }
  }
  const message = await channel.send(payload);
  await prisma.linkSettings.update({ where: { id: 1 }, data: { messageId: message.id, messageChannelId: channel.id } });
  lastPanel = JSON.stringify([channel.id, message.id, s.panelTitle, s.panelText, s.buttonLabel]);
  event("panel.sent", `Сообщение с кнопкой «Привязать» отправлено в #${channel.name}`, { details: { channelId: channel.id, messageId: message.id } });
}

export function resetPanelState(): void {
  lastPanel = "";
}

// --- кнопка и форма ---

function linkedText(link: SteamLink): string {
  return `Steam **${escapeMarkdown(link.steamName)}** ([профиль](${steamProfileUrl(link.steamId)}), \`${link.steamId}\`)`;
}

async function onButton(interaction: ButtonInteraction<"cached">) {
  const existing = await prisma.steamLink.findUnique({ where: { discordId: interaction.user.id } });
  if (existing) {
    // Роль могли снять вручную — заодно вернём.
    await ensureRole(interaction.member, (await getSettings()).roleId);
    await interaction.reply({
      content: `Твой Discord уже привязан: ${linkedText(existing)}, <t:${unix(existing.linkedAt)}:D>.\nСменить привязку может администрация сервера.`,
      flags: ephemeral,
    });
    return;
  }
  if (wrongCodes.full(interaction.user.id)) {
    await interaction.reply({ content: "Слишком много неверных кодов. Попробуй через 10 минут.", flags: ephemeral });
    return;
  }
  const input = new TextInputBuilder()
    .setCustomId("code")
    .setLabel("Код из игры")
    .setStyle(TextInputStyle.Short)
    .setPlaceholder("Например: K7MQ2P")
    .setMinLength(LINK_CODE_LENGTH)
    .setMaxLength(LINK_CODE_LENGTH + 4)
    .setRequired(true);
  await interaction.showModal(
    new ModalBuilder()
      .setCustomId(MODAL_ID)
      .setTitle("Привязка Steam")
      .addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(input)),
  );
}

type LinkResult =
  | { ok: true; link: SteamLink }
  | { ok: false; reason: "bad_code" | "expired" | "steam_taken" | "discord_taken" };

// Всё в одной транзакции: два человека с одним кодом не привяжутся оба, а уникальность
// discordId и steamId в базе страхует от гонки, если транзакции всё же пересеклись.
async function linkAccounts(member: GuildMember, code: string): Promise<LinkResult> {
  try {
    return await prisma.$transaction(async (tx): Promise<LinkResult> => {
      const row = await tx.linkCode.findUnique({ where: { code } });
      if (!row) return { ok: false, reason: "bad_code" };
      if (row.expiresAt <= new Date()) {
        await tx.linkCode.delete({ where: { code } });
        return { ok: false, reason: "expired" };
      }
      if (await tx.steamLink.findUnique({ where: { discordId: member.id } })) return { ok: false, reason: "discord_taken" };
      if (await tx.steamLink.findUnique({ where: { steamId: row.steamId } })) {
        await tx.linkCode.delete({ where: { code } });
        return { ok: false, reason: "steam_taken" };
      }
      await tx.linkCode.delete({ where: { code } });
      const link = await tx.steamLink.create({
        data: {
          discordId: member.id,
          steamId: row.steamId,
          steamName: row.steamName,
          discordName: member.user.username,
          serverId: row.serverId,
          checkedAt: new Date(),
        },
      });
      return { ok: true, link };
    });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") return { ok: false, reason: "discord_taken" };
    throw err;
  }
}

const FAIL_TEXT: Record<Exclude<LinkResult, { ok: true }>["reason"], string> = {
  bad_code: "Такого кода нет. Проверь, что переписал его без ошибок, или получи новый: **/connect** в игре.",
  expired: "Срок кода истёк. Напиши **/connect** в игре ещё раз и введи новый код.",
  steam_taken: "Этот аккаунт Steam уже привязан к другому Discord. Если это ошибка, напиши администрации.",
  discord_taken: "Твой Discord уже привязан к аккаунту Steam. Сменить привязку может администрация.",
};

async function onModal(interaction: ModalSubmitInteraction<"cached">) {
  if (wrongCodes.full(interaction.user.id)) {
    await interaction.reply({ content: "Слишком много неверных кодов. Попробуй через 10 минут.", flags: ephemeral });
    return;
  }
  const code = normalizeLinkCode(interaction.fields.getTextInputValue("code"));
  if (!code) {
    wrongCodes.take(interaction.user.id);
    await interaction.reply({
      content: `⚠️ Код — ${LINK_CODE_LENGTH} латинских букв и цифр, например K7MQ2P. Получить его: **/connect** в чате на сервере.`,
      flags: ephemeral,
    });
    return;
  }

  await interaction.deferReply({ flags: ephemeral });
  const result = await linkAccounts(interaction.member, code);
  if (!result.ok) {
    if (result.reason === "bad_code") wrongCodes.take(interaction.user.id);
    await interaction.editReply(`⚠️ ${FAIL_TEXT[result.reason]}`);
    return;
  }

  const { link } = result;
  const s = await getSettings();
  const roleOk = await ensureRole(interaction.member, s.roleId);
  event("link.created", `${interaction.user.username} привязал Steam ${link.steamName} (${link.steamId})`, {
    memberId: interaction.user.id,
    details: { steamId: link.steamId, steamName: link.steamName, serverId: link.serverId },
  });

  let text = `✅ Готово! Твой Discord привязан к ${linkedText(link)}.`;
  if (s.roleId) text += roleOk ? `\nВыдана роль <@&${s.roleId}>.` : "\nРоль выдам чуть позже: сейчас не получилось.";
  await interaction.editReply(text);
}

async function safeError(interaction: RepliableInteraction) {
  try {
    const payload = { content: "⚠️ Что-то пошло не так. Попробуй ещё раз чуть позже.", flags: ephemeral } as const;
    if (interaction.deferred || interaction.replied) await interaction.followUp(payload);
    else await interaction.reply(payload);
  } catch {
    // Взаимодействие могло истечь, тут уже ничего не сделать.
  }
}

export async function handleInteraction(interaction: Interaction): Promise<void> {
  if (!interaction.inCachedGuild() || interaction.guildId !== config.GUILD_ID) return;
  const ours = (interaction.isButton() && interaction.customId === BUTTON_ID) || (interaction.isModalSubmit() && interaction.customId === MODAL_ID);
  if (!ours || !interaction.isRepliable()) return;

  if (!limiter.take(interaction.user.id)) {
    await interaction.reply({ content: "Слишком часто. Подожди пару секунд.", flags: ephemeral }).catch(() => undefined);
    return;
  }
  try {
    if (interaction.isButton()) await onButton(interaction);
    else if (interaction.isModalSubmit()) await onModal(interaction);
  } catch (err) {
    log.error("Ошибка обработки нажатия", err);
    await safeError(interaction);
  }
}

// --- фоновые проверки ---

const RECHECK_MS = 6 * 60 * 60_000;

// Каждые полминуты бот проверяет по очереди 25 привязок: на сервере ли человек и есть ли у него роль.
// Так роль возвращается тем, кто перезашёл на сервер или кому её сняли, без привилегированных интентов.
export async function checkLinks(guild: Guild): Promise<void> {
  const s = await getSettings();
  const rows = await prisma.steamLink.findMany({
    where: { OR: [{ checkedAt: null }, { checkedAt: { lt: new Date(Date.now() - RECHECK_MS) } }] },
    orderBy: { checkedAt: { sort: "asc", nulls: "first" } },
    take: 25,
  });
  for (const link of rows) {
    const member = await fetchMember(guild, link.discordId);
    if (member) await ensureRole(member, s.roleId);
    await prisma.steamLink.update({
      where: { discordId: link.discordId },
      data: { checkedAt: new Date(), inGuild: member !== null, ...(member ? { discordName: member.user.username } : {}) },
    });
  }
}

// Задания из панели: после отвязки снять роль.
export async function runActions(guild: Guild): Promise<void> {
  const actions = await prisma.linkAction.findMany({ where: { doneAt: null }, orderBy: { id: "asc" }, take: 20 });
  if (actions.length === 0) return;
  const s = await getSettings();
  for (const a of actions) {
    // Пока задание ждало, человек мог привязаться заново — тогда роль остаётся.
    const relinked = await prisma.steamLink.findUnique({ where: { discordId: a.discordId } });
    if (a.kind === "unlink" && !relinked && s.roleId) {
      const member = await fetchMember(guild, a.discordId);
      if (member?.roles.cache.has(s.roleId)) {
        try {
          await member.roles.remove(s.roleId, "Привязка Steam снята в панели");
          event("role.removed", `${member.user.username}: снята роль за привязку, привязку убрали в панели`, { memberId: member.id, details: { roleId: s.roleId } });
        } catch (err) {
          log.warn(`Не удалось снять роль за привязку у ${member.user.username}`, err);
        }
      }
    }
    await prisma.linkAction.update({ where: { id: a.id }, data: { doneAt: new Date() } });
  }
}
