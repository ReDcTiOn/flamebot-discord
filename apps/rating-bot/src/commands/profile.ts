import {
  AttachmentBuilder,
  ContainerBuilder,
  Locale,
  MediaGalleryBuilder,
  MediaGalleryItemBuilder,
  MessageFlags,
  SlashCommandBuilder,
  escapeMarkdown,
} from "discord.js";
import { formatNumber, levelProgress, prisma, rankProgress } from "@flamebot/core";
import { profileTexts, purchasesBlock, stripEmoji, type ProfilePurchase } from "@flamebot/core/card";
import { log } from "../logger.js";
import { getState } from "../state.js";
import { renderProfileCard } from "../services/card.js";
import { ensureMember, topPosition } from "../services/members.js";
import { SCRAP, UI, V2, divider, serverEmojis, text } from "../ui.js";
import { progressBar } from "../util.js";
import type { Command } from "./types.js";

// Что у игрока куплено: действующие роли, заявки на проверке и бейджи, которые у него ещё есть.
async function activePurchases(memberId: string, badgeLabels: string[]): Promise<ProfilePurchase[]> {
  const rows = await prisma.purchase.findMany({
    where: { memberId, OR: [{ active: true }, { request: { status: "PENDING" } }, { item: { type: "BADGE" } }] },
    include: { item: true, request: true },
    orderBy: { createdAt: "asc" },
  });
  const badges = new Set(badgeLabels);
  return rows.flatMap((p) => {
    if (p.item.type === "BADGE" && !(p.item.badgeLabel && badges.has(p.item.badgeLabel))) return [];
    const name = p.customName ? `${p.item.name} «${p.customName}»` : p.item.name;
    return [{ item: escapeMarkdown(name), price: p.price, expiresAt: p.active ? p.expiresAt : null, pending: p.request?.status === "PENDING" }];
  });
}

// Профиль текстом — если картинку выключили в панели или она не нарисовалась.
function textProfile(o: {
  name: string;
  rank: string;
  place: number;
  xp: number;
  nextName: string | null;
  nextLevel: number | null;
  nextXp: number | null;
  scrap: number;
  rep: number;
  messages: number;
  voiceSeconds: number;
  badges: string[];
}): string {
  const lv = levelProgress(o.xp);
  const next =
    o.nextName && o.nextXp !== null
      ? `До ранга «${escapeMarkdown(o.nextName)}» (${o.nextLevel} ур.): ${formatNumber(Math.max(0, o.nextXp - o.xp))} опыта`
      : "Максимальный ранг";
  const lines = [
    `## ${escapeMarkdown(o.name)}`,
    `**${o.rank}** · место в топе **#${o.place}**`,
    `**Уровень ${lv.level}** · ${progressBar(lv.ratio)}  ${formatNumber(Math.floor(lv.into))} / ${formatNumber(lv.need)}`,
    next,
    `${SCRAP} ${formatNumber(o.scrap)} · Репутация: ${formatNumber(o.rep)} · Сообщений: ${formatNumber(o.messages)}`,
    `Опыт: ${formatNumber(o.xp)} · В голосе: ${formatNumber(Math.round(o.voiceSeconds / 360) / 10)} ч`,
  ];
  if (o.badges.length > 0) lines.push(`Бейджи: ${o.badges.map((b) => `\`${escapeMarkdown(b)}\``).join(" ")}`);
  return lines.join("\n");
}

export const profileCommand: Command = {
  data: new SlashCommandBuilder()
    .setName("profile")
    .setNameLocalizations({ [Locale.Russian]: "профиль" })
    .setDescription("Профиль игрока: ранг, скрап, репутация, покупки")
    .addUserOption((o) => o.setName("игрок").setDescription("Чей профиль показать").setRequired(false))
    .toJSON(),

  async execute(interaction) {
    const user = interaction.options.getUser("игрок") ?? interaction.user;
    if (user.bot) {
      await interaction.reply({ content: "У ботов нет профиля.", flags: MessageFlags.Ephemeral });
      return;
    }
    // Картинка рисуется дольше трёх секунд на холодном старте, поэтому сначала подтверждаем команду.
    await interaction.deferReply();

    const guildMember = interaction.options.getMember("игрок") ?? (user.id === interaction.user.id ? interaction.member : null);
    const row = await ensureMember(user, guildMember);
    const [{ settings, ranks }, place, badges] = await Promise.all([
      getState(),
      topPosition(row.xp),
      prisma.memberBadge.findMany({ where: { memberId: user.id }, orderBy: { createdAt: "asc" } }),
    ]);
    const badgeLabels = badges.map((b) => b.label);
    const purchases = await activePurchases(user.id, badgeLabels);

    const { current, next, ratio } = rankProgress(ranks, row.xp);
    const displayName = guildMember?.displayName ?? user.globalName ?? user.username;
    // Сверху карточка, под ней — что куплено и до какого числа.
    const container = new ContainerBuilder().setAccentColor(UI.brand);
    const files: AttachmentBuilder[] = [];

    if (settings.profileCardEnabled) {
      try {
        const png = await renderProfileCard(
          {
            name: displayName,
            username: user.username,
            rank: current ? stripEmoji(current.name) : "Без ранга",
            nextRank: next ? stripEmoji(next.name) : "максимум",
            xp: row.xp,
            nextXp: next?.minXp ?? null,
            progress: ratio,
            scrap: row.scrap,
            rep: row.rep,
            messages: row.messageCount,
            place,
            server: interaction.guild.name,
            badges: badgeLabels,
          },
          user.displayAvatarURL({ extension: "png", size: 256, forceStatic: true }),
        );
        files.push(new AttachmentBuilder(png, { name: "profile.png" }));
        container.addMediaGalleryComponents(new MediaGalleryBuilder().addItems(new MediaGalleryItemBuilder().setURL("attachment://profile.png")));
      } catch (err) {
        // Если картинка не нарисовалась, показываем профиль текстом.
        log.error("Не удалось нарисовать карточку профиля", err);
      }
    }
    if (files.length === 0) {
      container.addTextDisplayComponents(
        text(
          textProfile({
            name: displayName,
            rank: current ? `${current.emoji ?? ""} ${escapeMarkdown(current.name)}`.trim() : "Без ранга",
            place,
            xp: row.xp,
            nextName: next?.name ?? null,
            nextLevel: next?.minLevel ?? null,
            nextXp: next?.minXp ?? null,
            scrap: row.scrap,
            rep: row.rep,
            messages: row.messageCount,
            voiceSeconds: row.voiceSeconds,
            badges: badgeLabels,
          }),
        ),
      );
    }

    const block = serverEmojis(purchasesBlock(profileTexts(settings.profileTexts), purchases), interaction.guild);
    container.addSeparatorComponents(divider()).addTextDisplayComponents(text(block));
    await interaction.editReply({ components: [container], files, flags: V2, allowedMentions: { parse: [] } });
  },
};
