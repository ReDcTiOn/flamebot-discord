import { EmbedBuilder, MessageFlags, SlashCommandBuilder, escapeMarkdown } from "discord.js";
import { formatNumber, prisma } from "@flamebot/core";
import { getState } from "../state.js";
import { COLORS, type Command } from "./types.js";

const CATEGORIES = {
  xp: { label: "опыту", field: "xp" },
  rep: { label: "репутации", field: "rep" },
  scrap: { label: "скрапу", field: "scrap" },
} as const;

type Category = keyof typeof CATEGORIES;

export const topCommand: Command = {
  data: new SlashCommandBuilder()
    .setName("top")
    .setDescription("Таблица лидеров сервера")
    .addStringOption((o) =>
      o
        .setName("по")
        .setDescription("По чему считать")
        .setRequired(false)
        .addChoices(
          { name: "Опыт", value: "xp" },
          { name: "Репутация", value: "rep" },
          { name: "Скрап", value: "scrap" },
        ),
    )
    .toJSON(),

  async execute(interaction) {
    const raw = interaction.options.getString("по") ?? "xp";
    const category: Category = raw in CATEGORIES ? (raw as Category) : "xp";
    const { field, label } = CATEGORIES[category];

    const [rows, { ranks }] = await Promise.all([
      prisma.member.findMany({
        where: { inGuild: true },
        orderBy: [{ [field]: "desc" }, { createdAt: "asc" }],
        take: 10,
        include: { rank: true },
      }),
      getState(),
    ]);

    if (rows.length === 0) {
      await interaction.reply({ content: "Пока никого нет в рейтинге. Пишите в чат, и он появится.", flags: MessageFlags.Ephemeral });
      return;
    }

    const medals = ["🥇", "🥈", "🥉"];
    const lines = rows.map((r, i) => {
      const place = medals[i] ?? `\`${String(i + 1).padStart(2, " ")}\``;
      const rank = r.rank ?? ranks[0];
      const rankText = rank ? ` · ${rank.emoji ?? ""} ${escapeMarkdown(rank.name)}`.replace("  ", " ") : "";
      return `${place} **${escapeMarkdown(r.displayName)}** — ${formatNumber(r[field])}${category === "xp" ? rankText : ""}`;
    });

    const embed = new EmbedBuilder()
      .setColor(COLORS.brand)
      .setTitle(`Топ по ${label}`)
      .setDescription(lines.join("\n"));

    await interaction.reply({ embeds: [embed], allowedMentions: { parse: [] } });
  },
};
