import {
  ButtonStyle,
  ContainerBuilder,
  SectionBuilder,
  Locale,
  SlashCommandBuilder,
  ThumbnailBuilder,
  escapeMarkdown,
  type ButtonInteraction,
  type ChatInputCommandInteraction,
} from "discord.js";
import { formatNumber, levelFromExp, prisma, type Rank } from "@flamebot/core";
import { getState } from "../state.js";
import { SCRAP, UI, V2, avatarUrl, button, buttonRow, divider, text } from "../ui.js";
import type { Command } from "./types.js";

const CATEGORIES = {
  xp: { title: "по опыту", button: "Опыт", emoji: "✨", unit: "опыта", field: "xp" },
  rep: { title: "по репутации", button: "Репутация", emoji: "👍", unit: "репутации", field: "rep" },
  scrap: { title: "по скрапу", button: "Скрап", emoji: SCRAP, unit: "скрапа", field: "scrap" },
} as const;

type Category = keyof typeof CATEGORIES;
const MEDALS = ["🥇", "🥈", "🥉"];

function rankLabel(rank: Rank | null | undefined): string {
  return rank ? `${rank.emoji ? `${rank.emoji} ` : ""}${escapeMarkdown(rank.name)}` : "без ранга";
}

export async function buildTop(category: Category, viewerId: string, guildName: string) {
  const c = CATEGORIES[category];
  const [rows, me, { ranks }] = await Promise.all([
    prisma.member.findMany({
      where: { inGuild: true },
      orderBy: [{ [c.field]: "desc" }, { createdAt: "asc" }],
      take: 10,
      include: { rank: true },
    }),
    prisma.member.findUnique({ where: { id: viewerId } }),
    getState(),
  ]);

  const container = new ContainerBuilder()
    .setAccentColor(UI.gold)
    .addTextDisplayComponents(text(`## 🏆 Топ ${c.title}\n-# ${escapeMarkdown(guildName)} · лучшие 10 игроков`));

  if (rows.length === 0) {
    container.addSeparatorComponents(divider()).addTextDisplayComponents(text("Пока никого нет в рейтинге. Пишите в чат, и он появится."));
    return container;
  }

  container.addSeparatorComponents(divider(true));

  // Первые три места — крупно и с аватаром.
  rows.slice(0, 3).forEach((r, i) => {
    const value = `**${formatNumber(r[c.field])}** ${c.unit}`;
    const level = `${levelFromExp(r.xp)} ур.`;
    const extra = category === "xp" ? `${level} · ${rankLabel(r.rank ?? ranks[0])}` : `${level} · ${rankLabel(r.rank)} · ${formatNumber(r.xp)} опыта`;
    container.addSectionComponents(
      new SectionBuilder()
        .addTextDisplayComponents(text(`### ${MEDALS[i]} ${escapeMarkdown(r.displayName)}\n${c.emoji} ${value}\n-# ${extra}`))
        .setThumbnailAccessory(new ThumbnailBuilder().setURL(avatarUrl(r.id, r.avatarHash)).setDescription(r.displayName.slice(0, 100))),
    );
  });

  // Остальные — компактным списком.
  if (rows.length > 3) {
    const lines = rows.slice(3).map((r, i) => {
      const place = String(i + 4).padStart(2, " ");
      return `\`${place}\`  **${escapeMarkdown(r.displayName)}** — ${formatNumber(r[c.field])} ${c.emoji} · ${levelFromExp(r.xp)} ур. · ${rankLabel(r.rank)}`;
    });
    container.addSeparatorComponents(divider()).addTextDisplayComponents(text(lines.join("\n")));
  }

  // Место того, кто вызвал команду.
  if (me) {
    const place = (await prisma.member.count({ where: { inGuild: true, [c.field]: { gt: me[c.field] } } })) + 1;
    container
      .addSeparatorComponents(divider())
      .addTextDisplayComponents(text(`-# Твоё место: **#${place}** · ${formatNumber(me[c.field])} ${c.unit}`));
  }

  container.addActionRowComponents(
    buttonRow(
      ...(Object.keys(CATEGORIES) as Category[]).map((k) =>
        button(`top:${k}`, CATEGORIES[k].button, k === category ? ButtonStyle.Primary : ButtonStyle.Secondary, CATEGORIES[k].emoji).setDisabled(k === category),
      ),
    ),
  );
  return container;
}

export const topCommand: Command = {
  data: new SlashCommandBuilder()
    .setName("top")
    .setNameLocalizations({ [Locale.Russian]: "топ" })
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
  componentPrefix: "top",

  async execute(interaction: ChatInputCommandInteraction<"cached">) {
    const raw = interaction.options.getString("по") ?? "xp";
    const category: Category = raw in CATEGORIES ? (raw as Category) : "xp";
    const container = await buildTop(category, interaction.user.id, interaction.guild.name);
    await interaction.reply({ components: [container], flags: V2, allowedMentions: { parse: [] } });
  },

  async handleComponent(interaction) {
    if (!interaction.isButton()) return;
    const raw = interaction.customId.split(":")[1] ?? "xp";
    const category: Category = raw in CATEGORIES ? (raw as Category) : "xp";
    const container = await buildTop(category, interaction.user.id, interaction.guild.name);
    await (interaction as ButtonInteraction<"cached">).update({ components: [container], flags: V2, allowedMentions: { parse: [] } });
  },
};
