import { createCanvas } from "@napi-rs/canvas";
import {
  AttachmentBuilder,
  ButtonStyle,
  ContainerBuilder,
  DiscordAPIError,
  MediaGalleryBuilder,
  MediaGalleryItemBuilder,
  ModalBuilder,
  PermissionFlagsBits,
  RESTJSONErrorCodes,
  SectionBuilder,
  TextInputBuilder,
  TextInputStyle,
  ThumbnailBuilder,
  ActionRowBuilder,
  escapeMarkdown,
  type ButtonInteraction,
  type Guild,
  type GuildMember,
  type ModalSubmitInteraction,
  type User,
} from "discord.js";
import { formatNumber, getPanelSettings, prisma, type CustomRoleRequest, type Purchase, type ShopItem } from "@flamebot/core";
import { log } from "../logger.js";
import { getState } from "../state.js";
import { SCRAP, UI, V2, V2_EPHEMERAL, avatarUrl, button, buttonRow, divider, notice, text } from "../ui.js";
import { withLock } from "../util.js";
import { registerFonts } from "./card.js";

const DAY = 86_400_000;
const REQUEST_TTL_DAYS = 7;

type RequestWithItem = CustomRoleRequest & { purchase: Purchase & { item: ShopItem } };

const hex = (color: number | null) => (color === null ? "без цвета" : `#${color.toString(16).padStart(6, "0").toUpperCase()}`);

// ---------- Создание роли и возврат скрапа ----------

export async function createCustomRole(guild: Guild, member: GuildMember, name: string, color: number | null, purchaseId: number): Promise<string> {
  const role = await guild.roles.create({
    name,
    color: color ?? 0,
    permissions: [],
    mentionable: false,
    hoist: false,
    reason: `Scrap Rank: личная роль, покупка #${purchaseId}`,
  });
  const top = guild.members.me?.roles.highest.position ?? 1;
  await role.setPosition(Math.max(1, top - 1)).catch(() => undefined);
  try {
    await member.roles.add(role, `Scrap Rank: покупка #${purchaseId}`);
  } catch (err) {
    await role.delete("Scrap Rank: не удалось выдать роль").catch(() => undefined);
    throw err;
  }
  return role.id;
}

export async function refundPurchase(purchase: Purchase & { item: ShopItem }): Promise<void> {
  await prisma.$transaction([
    prisma.member.update({ where: { id: purchase.memberId }, data: { scrap: { increment: purchase.price } } }),
    prisma.purchase.update({ where: { id: purchase.id }, data: { active: false } }),
    ...(purchase.item.stock !== null ? [prisma.shopItem.update({ where: { id: purchase.itemId }, data: { stock: { increment: 1 } } })] : []),
  ]);
}

// ---------- Кто может решать заявки ----------

async function canModerate(member: GuildMember): Promise<boolean> {
  const p = member.permissions;
  if (p.has(PermissionFlagsBits.Administrator) || p.has(PermissionFlagsBits.ManageGuild) || p.has(PermissionFlagsBits.ManageRoles)) return true;
  const panel = await getPanelSettings(prisma);
  return member.roles.cache.some((r) => panel.panelRoleIds.includes(r.id));
}

// ---------- Сообщение с заявкой ----------

// Картинка-превью: как название будет выглядеть в списке участников Discord.
export function previewImage(name: string, color: number | null): Buffer {
  registerFonts();
  const w = 640;
  const h = 120;
  const c = createCanvas(w, h);
  const ctx = c.getContext("2d");
  ctx.fillStyle = "#2b2d31";
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = "#5865f2";
  ctx.beginPath();
  ctx.arc(60, h / 2, 30, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = color ? `#${color.toString(16).padStart(6, "0")}` : "#f2f3f5";
  ctx.font = '600 30px "FB Inter"';
  ctx.textBaseline = "middle";
  ctx.fillText(name, 108, h / 2 - 12);
  ctx.fillStyle = "#949ba4";
  ctx.font = '400 18px "FB Inter"';
  ctx.fillText("так роль будет выглядеть на сервере", 108, h / 2 + 22);
  return c.toBuffer("image/png");
}

export function requestView(req: CustomRoleRequest, item: ShopItem, user: Pick<User, "id" | "username" | "avatar">, withPreview: boolean) {
  const status =
    req.status === "PENDING"
      ? "⏳ Ждёт решения"
      : req.status === "APPROVED"
        ? `✅ Одобрено: <@${req.decidedById}>`
        : req.status === "REJECTED"
          ? `❌ Отклонено: <@${req.decidedById}>${req.reason ? ` · ${escapeMarkdown(req.reason)}` : ""}`
          : `⌛ Истёк срок · ${escapeMarkdown(req.reason ?? "")}`;
  const color = req.status === "PENDING" ? UI.info : req.status === "APPROVED" ? UI.success : UI.danger;

  const c = new ContainerBuilder()
    .setAccentColor(color)
    .addTextDisplayComponents(text(`## 👑 Заявка на личную роль #${req.id}`))
    .addSectionComponents(
      new SectionBuilder()
        .addTextDisplayComponents(
          text(
            `**Игрок:** <@${user.id}> · \`${escapeMarkdown(user.username)}\`\n` +
              `**Название:** \`${escapeMarkdown(req.name)}\`\n` +
              `**Цвет:** \`${hex(req.color)}\`\n` +
              `**Срок:** ${item.durationDays ? `${item.durationDays} д.` : "навсегда"} · **Цена:** ${formatNumber(item.price)} ${SCRAP}`,
          ),
        )
        .setThumbnailAccessory(new ThumbnailBuilder().setURL(avatarUrl(user.id, user.avatar))),
    );
  if (withPreview) {
    c.addMediaGalleryComponents(new MediaGalleryBuilder().addItems(new MediaGalleryItemBuilder().setURL("attachment://role-preview.png")));
  }
  c.addSeparatorComponents(divider()).addTextDisplayComponents(text(`**Статус:** ${status}`));
  if (req.status === "PENDING") {
    c.addTextDisplayComponents(text(`-# Скрап уже списан и вернётся игроку при отказе. Без решения заявка закроется через ${REQUEST_TTL_DAYS} дней.`));
    c.addActionRowComponents(
      buttonRow(
        button(`customrole:approve:${req.id}`, "Одобрить", ButtonStyle.Success, "✅"),
        button(`customrole:reject:${req.id}`, "Отклонить", ButtonStyle.Danger, "✖️"),
      ),
    );
  }
  return c;
}

// Отправляет заявку в канал проверки. Возвращает false, если канал недоступен.
export async function postRequest(guild: Guild, channelId: string, req: CustomRoleRequest, item: ShopItem, user: User): Promise<boolean> {
  const channel = guild.channels.cache.get(channelId);
  if (!channel || !channel.isTextBased() || !channel.isSendable()) return false;
  // Превью прикладываем, только если у бота есть право на файлы в этом канале.
  const me = guild.members.me;
  const canAttach = !!me && !channel.isDMBased() && channel.permissionsFor(me).has(PermissionFlagsBits.AttachFiles);
  const msg = await channel.send({
    components: [requestView(req, item, user, canAttach)],
    files: canAttach ? [new AttachmentBuilder(previewImage(req.name, req.color), { name: "role-preview.png" })] : [],
    flags: V2,
    allowedMentions: { parse: [] },
  });
  await prisma.customRoleRequest.update({ where: { id: req.id }, data: { channelId: msg.channelId, messageId: msg.id } });
  return true;
}

async function refreshMessage(guild: Guild, req: RequestWithItem) {
  if (!req.channelId || !req.messageId) return;
  try {
    const channel = guild.channels.cache.get(req.channelId);
    if (!channel?.isTextBased()) return;
    const msg = await channel.messages.fetch(req.messageId);
    const user = await guild.client.users.fetch(req.memberId);
    const hasPreview = msg.attachments.some((a) => a.name === "role-preview.png");
    await msg.edit({ components: [requestView(req, req.purchase.item, user, hasPreview)], flags: V2, allowedMentions: { parse: [] } });
  } catch (err) {
    log.warn(`Не удалось обновить сообщение заявки #${req.id}`, err);
  }
}

async function notifyPlayer(guild: Guild, req: RequestWithItem) {
  const title =
    req.status === "APPROVED" ? "✅ Личная роль одобрена" : req.status === "EXPIRED" ? "⌛ Заявка на личную роль закрыта" : "❌ Личная роль отклонена";
  const body =
    req.status === "APPROVED"
      ? `Роль **${escapeMarkdown(req.name)}** выдана на сервере **${escapeMarkdown(guild.name)}**.${req.purchase.expiresAt ? ` Действует до ${req.purchase.expiresAt.toLocaleDateString("ru-RU")}.` : ""}`
      : `Роль **${escapeMarkdown(req.name)}** не выдана${req.reason ? `: ${escapeMarkdown(req.reason)}` : ""}.\nСкрап (${formatNumber(req.purchase.price)} ${SCRAP}) вернулся на баланс.`;
  try {
    const user = await guild.client.users.fetch(req.memberId);
    await user.send({ components: [notice(req.status === "APPROVED" ? UI.success : UI.danger, title, body)], flags: V2 });
  } catch {
    // Личные сообщения закрыты — решение всё равно видно в канале и в /profile.
  }
}

async function audit(actor: { id: string; name: string }, action: string, req: CustomRoleRequest, details: Record<string, unknown> = {}) {
  await prisma.auditLog
    .create({ data: { module: "rating", actorId: actor.id, actorName: actor.name, action, target: `#${req.id} «${req.name}»`, details: { memberId: req.memberId, ...details } } })
    .catch(() => undefined);
}

async function loadRequest(id: number): Promise<RequestWithItem | null> {
  if (!Number.isInteger(id) || id <= 0) return null;
  return prisma.customRoleRequest.findUnique({ where: { id }, include: { purchase: { include: { item: true } } } });
}

// ---------- Решения ----------

async function reject(guild: Guild, id: number, actor: { id: string; name: string }, reason: string | null, status: "REJECTED" | "EXPIRED" = "REJECTED") {
  return withLock(`customrole:${id}`, async () => {
    const req = await loadRequest(id);
    if (!req || req.status !== "PENDING") return null;
    await refundPurchase(req.purchase);
    const updated = await prisma.customRoleRequest.update({
      where: { id },
      data: { status, reason, decidedById: actor.id, decidedByName: actor.name, decidedAt: new Date() },
      include: { purchase: { include: { item: true } } },
    });
    await audit(actor, status === "EXPIRED" ? "customrole.expire" : "customrole.reject", updated, { reason });
    await refreshMessage(guild, updated);
    await notifyPlayer(guild, updated);
    return updated;
  });
}

async function approve(guild: Guild, id: number, actor: { id: string; name: string }): Promise<string | null> {
  return withLock(`customrole:${id}`, async () => {
    const req = await loadRequest(id);
    if (!req || req.status !== "PENDING") return "Эту заявку уже рассмотрели.";

    const member = await guild.members.fetch(req.memberId).catch((e) => {
      if (e instanceof DiscordAPIError && e.code === RESTJSONErrorCodes.UnknownMember) return null;
      throw e;
    });
    if (!member) return "Игрок уже вышел с сервера. Отклони заявку, чтобы закрыть её.";
    if (!guild.members.me?.permissions.has(PermissionFlagsBits.ManageRoles)) return "У бота нет права управлять ролями.";

    const roleId = await createCustomRole(guild, member, req.name, req.color, req.purchaseId);
    const days = req.purchase.item.durationDays;
    await prisma.purchase.update({
      where: { id: req.purchaseId },
      data: { active: true, roleId, expiresAt: days ? new Date(Date.now() + days * DAY) : null },
    });
    const updated = await prisma.customRoleRequest.update({
      where: { id },
      data: { status: "APPROVED", decidedById: actor.id, decidedByName: actor.name, decidedAt: new Date() },
      include: { purchase: { include: { item: true } } },
    });
    await audit(actor, "customrole.approve", updated, { roleId });
    await refreshMessage(guild, updated);
    await notifyPlayer(guild, updated);
    return null;
  });
}

// ---------- Обработка кнопок и окна с причиной ----------

export const customRoleHandler = {
  prefix: "customrole",

  async handleComponent(interaction: ButtonInteraction<"cached">) {
    const [, action, raw] = interaction.customId.split(":");
    const id = Number(raw);
    if (!(await canModerate(interaction.member))) {
      await interaction.reply({ components: [notice(UI.danger, "Нет доступа", "Решать заявки могут администраторы и роли с доступом к панели.")], flags: V2_EPHEMERAL });
      return;
    }
    const actor = { id: interaction.user.id, name: interaction.member.displayName };

    if (action === "approve") {
      // Создание роли может занять больше трёх секунд.
      await interaction.deferReply({ flags: V2_EPHEMERAL });
      try {
        const problem = await approve(interaction.guild, id, actor);
        await interaction.editReply({
          components: [problem ? notice(UI.danger, "Не получилось", problem) : notice(UI.success, "Одобрено", "Роль создана и выдана игроку.")],
        });
      } catch (err) {
        log.error(`Ошибка одобрения заявки #${id}`, err);
        await interaction.editReply({ components: [notice(UI.danger, "Не получилось", "Discord не дал создать роль. Проверь, что роль бота выше личных ролей, и попробуй ещё раз.")] });
      }
      return;
    }

    if (action === "reject") {
      await interaction.showModal(
        new ModalBuilder()
          .setCustomId(`customrole:rejectmodal:${id}`)
          .setTitle(`Отклонить заявку #${id}`)
          .addComponents(
            new ActionRowBuilder<TextInputBuilder>().addComponents(
              new TextInputBuilder()
                .setCustomId("reason")
                .setLabel("Причина (увидит игрок)")
                .setStyle(TextInputStyle.Short)
                .setMaxLength(200)
                .setPlaceholder("Неприличное название")
                .setRequired(false),
            ),
          ),
      );
    }
  },

  async handleModal(interaction: ModalSubmitInteraction<"cached">) {
    const [, action, raw] = interaction.customId.split(":");
    if (action !== "rejectmodal") return;
    if (!(await canModerate(interaction.member))) return;
    await interaction.deferReply({ flags: V2_EPHEMERAL });
    const reason = interaction.fields.getTextInputValue("reason").trim().slice(0, 200) || null;
    const done = await reject(interaction.guild, Number(raw), { id: interaction.user.id, name: interaction.member.displayName }, reason);
    await interaction.editReply({
      components: [done ? notice(UI.success, "Отклонено", "Скрап вернулся игроку, ему пришло уведомление.") : notice(UI.danger, "Не получилось", "Эту заявку уже рассмотрели.")],
    });
  },
};

// Заявки без решения дольше недели закрываются с возвратом скрапа.
export async function expireOldRequests(guild: Guild): Promise<void> {
  const stale = await prisma.customRoleRequest.findMany({
    where: { status: "PENDING", createdAt: { lt: new Date(Date.now() - REQUEST_TTL_DAYS * DAY) } },
    select: { id: true },
    take: 20,
  });
  const bot = { id: guild.client.user.id, name: "Scrap Rank" };
  for (const r of stale) await reject(guild, r.id, bot, `никто не рассмотрел за ${REQUEST_TTL_DAYS} дней`, "EXPIRED");
}

export async function hasPendingRequest(memberId: string): Promise<boolean> {
  return (await prisma.customRoleRequest.count({ where: { memberId, status: "PENDING" } })) > 0;
}

export async function approvalChannelReady(guild: Guild): Promise<{ on: boolean; channelId: string | null; ok: boolean }> {
  const { settings } = await getState();
  if (!settings.customRoleApproval) return { on: false, channelId: null, ok: true };
  const ch = settings.approvalChannelId ? guild.channels.cache.get(settings.approvalChannelId) : undefined;
  return { on: true, channelId: settings.approvalChannelId, ok: !!ch && ch.isTextBased() && ch.isSendable() };
}
