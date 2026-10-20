import { AttachmentBuilder, EmbedBuilder, MessageFlags, SlashCommandBuilder, escapeMarkdown } from "discord.js";
import { formatNumber, prisma, rankProgress } from "@flamebot/core";
import { stripEmoji } from "@flamebot/core/card";
import { log } from "../logger.js";
import { getState } from "../state.js";
import { renderProfileCard } from "../services/card.js";
import { ensureMember, topPosition } from "../services/members.js";
import { progressBar } from "../util.js";
import { COLORS, type Command } from "./types.js";

export const profileCommand: Command = {
  data: new SlashCommandBuilder()
    .setName("profile")
    .setDescription("Профиль игрока: ранг, скрап, репутация")
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

    const { current, next, ratio } = rankProgress(ranks, row.xp);
    const displayName = guildMember?.displayName ?? user.globalName ?? user.username;

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
            badges: badges.map((b) => b.label),
          },
          user.displayAvatarURL({ extension: "png", size: 256, forceStatic: true }),
        );
        await interaction.editReply({ files: [new AttachmentBuilder(png, { name: "profile.png" })] });
        return;
      } catch (err) {
        // Если картинка не нарисовалась, показываем текстовую карточку.
        log.error("Не удалось нарисовать карточку профиля", err);
      }
    }

    const rankLabel = current ? `${current.emoji ?? ""} ${escapeMarkdown(current.name)}`.trim() : "Без ранга";
    const progressLine = next
      ? `${progressBar(ratio)}  ${formatNumber(row.xp)} / ${formatNumber(next.minXp)}\nДо ранга «${escapeMarkdown(next.name)}»`
      : `${progressBar(1)}  ${formatNumber(row.xp)}\nМаксимальный ранг`;

    const embed = new EmbedBuilder()
      .setColor(COLORS.brand)
      .setAuthor({ name: escapeMarkdown(displayName), iconURL: user.displayAvatarURL() })
      .setDescription(`**${rankLabel}** · место в топе **#${place}**\n\n${progressLine}`)
      .addFields(
        { name: "Скрап", value: formatNumber(row.scrap), inline: true },
        { name: "Репутация", value: formatNumber(row.rep), inline: true },
        { name: "Сообщений засчитано", value: formatNumber(row.messageCount), inline: true },
      );
    if (badges.length > 0) {
      embed.addFields({ name: "Бейджи", value: badges.map((b) => `\`${escapeMarkdown(b.label)}\``).join(" ").slice(0, 1024) });
    }
    await interaction.editReply({ embeds: [embed] });
  },
};
