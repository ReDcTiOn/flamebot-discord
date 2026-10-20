import {
  ActionRowBuilder,
  ButtonStyle,
  ContainerBuilder,
  ModalBuilder,
  SectionBuilder,
  SlashCommandBuilder,
  TextInputBuilder,
  TextInputStyle,
  escapeMarkdown,
  type GuildMember,
  type MessageComponentInteraction,
  type ModalSubmitInteraction,
} from "discord.js";
import { formatNumber, prisma, startOfUtcDay, type ShopItem } from "@flamebot/core";
import { log } from "../logger.js";
import { ensureMember } from "../services/members.js";
import { checkLiveRole, grantRole } from "../services/roles.js";
import { withLock } from "../util.js";
import { SCRAP, UI, V2, V2_EPHEMERAL, button, buttonRow, divider, notice, text } from "../ui.js";
import type { Command } from "./types.js";

const DAY = 86_400_000;
const TYPE_LABEL: Record<ShopItem["type"], string> = {
  ROLE: "Роль",
  CUSTOM_ROLE: "Личная роль",
  BADGE: "Бейдж",
};

// Слова, под которые нельзя маскировать личную роль.
const BLOCKED_ROLE_WORDS = [
  "админ", "admin", "модер", "moder", "owner", "владел", "staff", "стафф",
  "support", "поддержк", "разраб", "developer", "discord", "everyone", "here",
];

function sanitizeRoleName(raw: string): string {
  return raw
    .normalize("NFKC")
    .replace(/[\p{C}]/gu, "")
    .replace(/[@#<>`*_~|\\]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

async function loadItem(id: number): Promise<ShopItem | null> {
  if (!Number.isInteger(id) || id <= 0) return null;
  const item = await prisma.shopItem.findUnique({ where: { id } });
  return item?.enabled ? item : null;
}

class PurchaseError extends Error {}

async function purchase(
  interaction: MessageComponentInteraction<"cached"> | ModalSubmitInteraction<"cached">,
  item: ShopItem,
  customRole?: { name: string; color: number | null },
): Promise<{ item: ShopItem; expiresAt: Date | null; balance: number }> {
  const member: GuildMember = interaction.member;
  const guild = interaction.guild;

  return withLock(`shop:${member.id}`, async () => {
    // Всё перепроверяем внутри блокировки: цена, остаток и права могли измениться.
    const fresh = await loadItem(item.id);
    if (!fresh) throw new PurchaseError("Этот товар больше не продаётся.");
    item = fresh;

    const active = await prisma.purchase.findFirst({
      where: { memberId: member.id, itemId: item.id, active: true },
      orderBy: { createdAt: "desc" },
    });

    if (item.type === "ROLE") {
      const check = checkLiveRole(guild, item.roleId);
      if (!check.ok) throw new PurchaseError(`Товар сейчас недоступен: ${check.reason}.`);
      if (!active && member.roles.cache.has(item.roleId!)) throw new PurchaseError("У тебя уже есть эта роль.");
      if (active && !item.durationDays) throw new PurchaseError("Ты уже купил эту роль навсегда.");
    }
    if (item.type === "CUSTOM_ROLE") {
      if (active) throw new PurchaseError("У тебя уже есть личная роль. Дождись окончания срока.");
      if (!guild.members.me?.permissions.has("ManageRoles")) throw new PurchaseError("У бота нет права управлять ролями.");
    }
    if (item.type === "BADGE") {
      const has = await prisma.memberBadge.findUnique({
        where: { memberId_label: { memberId: member.id, label: item.badgeLabel! } },
      });
      if (has) throw new PurchaseError("Такой бейдж у тебя уже есть.");
    }

    await ensureMember(member.user, member);

    // Продление уже купленной роли со сроком.
    const extendFrom = active?.expiresAt && active.expiresAt.getTime() > Date.now() ? active.expiresAt.getTime() : Date.now();
    const expiresAt = item.durationDays ? new Date(extendFrom + item.durationDays * DAY) : null;

    // Списание и учёт остатка в одной транзакции. Условие scrap >= price проверяет сама база,
    // поэтому два одновременных запроса не уведут баланс в минус.
    const record = await prisma.$transaction(async (tx) => {
      const charged = await tx.member.updateMany({
        where: { id: member.id, scrap: { gte: item.price } },
        data: { scrap: { decrement: item.price } },
      });
      if (charged.count === 0) throw new PurchaseError("Не хватает скрапа.");

      if (item.stock !== null) {
        const taken = await tx.shopItem.updateMany({
          where: { id: item.id, stock: { gt: 0 } },
          data: { stock: { decrement: 1 } },
        });
        if (taken.count === 0) throw new PurchaseError("Товар закончился.");
      }

      const day = startOfUtcDay();
      await tx.dailyStat.upsert({
        where: { date: day },
        create: { date: day, scrapSpent: item.price },
        update: { scrapSpent: { increment: item.price } },
      });

      if (active && item.type === "ROLE") {
        await tx.purchase.update({ where: { id: active.id }, data: { expiresAt } });
        return tx.purchase.create({
          data: { memberId: member.id, itemId: item.id, price: item.price, roleId: item.roleId, active: false },
        });
      }
      return tx.purchase.create({
        data: {
          memberId: member.id,
          itemId: item.id,
          price: item.price,
          roleId: item.type === "ROLE" ? item.roleId : null,
          customName: customRole?.name ?? null,
          expiresAt,
          active: item.type !== "BADGE",
        },
      });
    });

    try {
      if (item.type === "ROLE") {
        const res = await grantRole(member, item.roleId!, `Scrap Rank: покупка #${record.id}`);
        if (!res.ok) throw new PurchaseError(res.reason);
      } else if (item.type === "CUSTOM_ROLE") {
        const role = await guild.roles.create({
          name: customRole!.name,
          color: customRole!.color ?? 0,
          permissions: [],
          mentionable: false,
          hoist: false,
          reason: `Scrap Rank: личная роль, покупка #${record.id}`,
        });
        const top = guild.members.me?.roles.highest.position ?? 1;
        await role.setPosition(Math.max(1, top - 1)).catch(() => undefined);
        await member.roles.add(role, `Scrap Rank: покупка #${record.id}`);
        await prisma.purchase.update({ where: { id: record.id }, data: { roleId: role.id } });
      } else {
        await prisma.memberBadge.create({ data: { memberId: member.id, label: item.badgeLabel! } });
      }
    } catch (err) {
      // Не смогли выдать товар: возвращаем скрап и остаток.
      log.warn(`Покупка #${record.id} не выдана, возврат`, err);
      await prisma.$transaction([
        prisma.member.update({ where: { id: member.id }, data: { scrap: { increment: item.price } } }),
        prisma.purchase.update({ where: { id: record.id }, data: { active: false } }),
        ...(item.stock !== null
          ? [prisma.shopItem.update({ where: { id: item.id }, data: { stock: { increment: 1 } } })]
          : []),
      ]);
      if (active && item.type === "ROLE") {
        await prisma.purchase.update({ where: { id: active.id }, data: { expiresAt: active.expiresAt } });
      }
      throw new PurchaseError(
        err instanceof PurchaseError ? `Не получилось выдать товар: ${err.message}. Скрап вернули.` : "Не получилось выдать товар. Скрап вернули.",
      );
    }

    const balance = (await prisma.member.findUnique({ where: { id: member.id }, select: { scrap: true } }))?.scrap ?? 0;
    return { item, expiresAt, balance };
  });
}

const PAGE_SIZE = 8;
const TYPE_EMOJI: Record<ShopItem["type"], string> = { ROLE: "🎨", CUSTOM_ROLE: "👑", BADGE: "🏅" };

function itemMeta(item: ShopItem): string {
  const parts: string[] = [TYPE_LABEL[item.type]];
  if (item.type === "BADGE") parts.push(`«${escapeMarkdown(item.badgeLabel ?? "")}»`);
  else parts.push(item.durationDays ? `${item.durationDays} д.` : "навсегда");
  if (item.stock !== null) parts.push(item.stock > 0 ? `осталось ${item.stock}` : "закончился");
  return parts.join(" · ");
}

export async function shopView(member: GuildMember, page: number) {
  const [items, me] = await Promise.all([
    prisma.shopItem.findMany({ where: { enabled: true }, orderBy: [{ sortOrder: "asc" }, { price: "asc" }], take: 100 }),
    ensureMember(member.user, member),
  ]);
  const pages = Math.max(1, Math.ceil(items.length / PAGE_SIZE));
  const p = Math.min(Math.max(0, page), pages - 1);

  const c = new ContainerBuilder()
    .setAccentColor(UI.brand)
    .addTextDisplayComponents(text(`## 🛒 Магазин за скрап\nТвой баланс: **${formatNumber(me.scrap)}** ${SCRAP}`));

  if (items.length === 0) {
    c.addSeparatorComponents(divider()).addTextDisplayComponents(text("Магазин пока пуст. Загляни позже."));
    return c;
  }
  c.addSeparatorComponents(divider(true));

  // Каждый товар — отдельная строка, справа кнопка с ценой.
  for (const item of items.slice(p * PAGE_SIZE, (p + 1) * PAGE_SIZE)) {
    const affordable = me.scrap >= item.price;
    const soldOut = item.stock !== null && item.stock <= 0;
    const desc = item.description ? `\n${escapeMarkdown(item.description)}` : "";
    c.addSectionComponents(
      new SectionBuilder()
        .addTextDisplayComponents(text(`${TYPE_EMOJI[item.type]} **${escapeMarkdown(item.name)}**${desc}\n-# ${itemMeta(item)}`))
        .setButtonAccessory(
          button(`shop:pick:${item.id}`, formatNumber(item.price), affordable && !soldOut ? ButtonStyle.Success : ButtonStyle.Secondary, SCRAP).setDisabled(soldOut),
        ),
    );
  }

  c.addSeparatorComponents(divider()).addTextDisplayComponents(
    text(`-# Нажми на цену, чтобы купить. Скрап дают за общение в чате и за новые ранги.${pages > 1 ? ` · Страница ${p + 1} из ${pages}` : ""}`),
  );
  if (pages > 1) {
    c.addActionRowComponents(
      buttonRow(
        button(`shop:page:${p - 1}`, "Назад", ButtonStyle.Secondary, "◀️").setDisabled(p === 0),
        button(`shop:page:${p + 1}`, "Дальше", ButtonStyle.Secondary, "▶️").setDisabled(p >= pages - 1),
      ),
    );
  }
  return c;
}

export function confirmView(item: ShopItem, balance: number) {
  const enough = balance >= item.price;
  const desc = item.description ? `\n${escapeMarkdown(item.description)}` : "";
  const after = enough
    ? `После покупки останется **${formatNumber(balance - item.price)}** ${SCRAP}`
    : `Не хватает **${formatNumber(item.price - balance)}** ${SCRAP}. Общайся в чате, и скрап накопится.`;
  return new ContainerBuilder()
    .setAccentColor(enough ? UI.info : UI.danger)
    .addTextDisplayComponents(text(`### ${TYPE_EMOJI[item.type]} ${escapeMarkdown(item.name)}${desc}\n-# ${itemMeta(item)}`))
    .addSeparatorComponents(divider())
    .addTextDisplayComponents(text(`Цена: **${formatNumber(item.price)}** ${SCRAP} · баланс: **${formatNumber(balance)}** ${SCRAP}\n${after}`))
    .addActionRowComponents(
      buttonRow(
        button(`shop:buy:${item.id}`, `Купить за ${formatNumber(item.price)}`, ButtonStyle.Success, SCRAP).setDisabled(!enough),
        button("shop:page:0", "Назад", ButtonStyle.Secondary),
      ),
    );
}

export function doneView(res: { item: ShopItem; expiresAt: Date | null; balance: number }) {
  const until = res.expiresAt ? `Действует до **${res.expiresAt.toLocaleDateString("ru-RU")}**.` : "Навсегда.";
  return notice(
    UI.success,
    `✅ Куплено: ${escapeMarkdown(res.item.name)}`,
    `${until}\nСписано **${formatNumber(res.item.price)}** ${SCRAP}, осталось **${formatNumber(res.balance)}** ${SCRAP}.`,
    button("shop:page:0", "В магазин", ButtonStyle.Secondary, "🛒"),
  );
}

export function errorView(message: string) {
  return notice(UI.danger, "Не получилось", message, button("shop:page:0", "В магазин", ButtonStyle.Secondary, "🛒"));
}

async function replyError(interaction: MessageComponentInteraction<"cached"> | ModalSubmitInteraction<"cached">, err: unknown) {
  const message = err instanceof PurchaseError ? err.message : "Что-то пошло не так. Попробуй ещё раз.";
  if (!(err instanceof PurchaseError)) log.error("Ошибка магазина", err);
  const components = [errorView(message)];
  if (interaction.deferred || interaction.replied) await interaction.editReply({ components, flags: V2 });
  else if (interaction.isMessageComponent() || interaction.isFromMessage()) await interaction.update({ components, flags: V2 });
  else await interaction.reply({ components, flags: V2_EPHEMERAL });
}

function customRoleModal(item: ShopItem) {
  return new ModalBuilder()
    .setCustomId(`shop:custom:${item.id}`)
    .setTitle("Личная роль")
    .addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder().setCustomId("name").setLabel("Название роли").setStyle(TextInputStyle.Short).setMinLength(2).setMaxLength(32).setRequired(true),
      ),
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId("color")
          .setLabel("Цвет в формате #RRGGBB (необязательно)")
          .setStyle(TextInputStyle.Short)
          .setMinLength(7)
          .setMaxLength(7)
          .setPlaceholder("#BA7517")
          .setRequired(false),
      ),
    );
}

export const shopCommand: Command = {
  data: new SlashCommandBuilder().setName("shop").setDescription("Магазин: что купить за скрап").toJSON(),
  componentPrefix: "shop",

  async execute(interaction) {
    await interaction.reply({ components: [await shopView(interaction.member, 0)], flags: V2_EPHEMERAL });
  },

  async handleComponent(interaction) {
    const [, action, raw] = interaction.customId.split(":");
    try {
      if (action === "page") {
        await interaction.update({ components: [await shopView(interaction.member, Number(raw) || 0)], flags: V2 });
        return;
      }

      const item = await loadItem(Number(raw));
      if (!item) throw new PurchaseError("Этот товар больше не продаётся.");

      if (action === "pick") {
        const me = await ensureMember(interaction.user, interaction.member);
        await interaction.update({ components: [confirmView(item, me.scrap)], flags: V2 });
        return;
      }

      if (action === "buy") {
        if (item.type === "CUSTOM_ROLE") {
          await interaction.showModal(customRoleModal(item));
          return;
        }
        // Выдача роли может занять больше трёх секунд, поэтому сначала подтверждаем нажатие.
        await interaction.deferUpdate();
        await interaction.editReply({ components: [doneView(await purchase(interaction, item))], flags: V2 });
      }
    } catch (err) {
      await replyError(interaction, err);
    }
  },

  async handleModal(interaction) {
    const [, action, idRaw] = interaction.customId.split(":");
    if (action !== "custom") return;
    try {
      const item = await loadItem(Number(idRaw));
      if (!item || item.type !== "CUSTOM_ROLE") throw new PurchaseError("Этот товар больше не продаётся.");

      const name = sanitizeRoleName(interaction.fields.getTextInputValue("name"));
      if (name.length < 2 || name.length > 32) throw new PurchaseError("Название роли должно быть от 2 до 32 символов.");
      const lower = name.toLowerCase();
      if (BLOCKED_ROLE_WORDS.some((w) => lower.includes(w))) throw new PurchaseError("Такое название роли использовать нельзя.");
      if (interaction.guild.roles.cache.some((r) => r.name.toLowerCase() === lower)) {
        throw new PurchaseError("Роль с таким названием уже есть на сервере.");
      }

      const colorRaw = interaction.fields.getTextInputValue("color").trim();
      let color: number | null = null;
      if (colorRaw) {
        if (!/^#[0-9a-fA-F]{6}$/.test(colorRaw)) throw new PurchaseError("Цвет нужно указать в формате #RRGGBB.");
        color = parseInt(colorRaw.slice(1), 16);
      }

      if (interaction.isFromMessage()) await interaction.deferUpdate();
      else await interaction.deferReply({ flags: V2_EPHEMERAL });
      await interaction.editReply({ components: [doneView(await purchase(interaction, item, { name, color }))], flags: V2 });
    } catch (err) {
      await replyError(interaction, err);
    }
  },
};
