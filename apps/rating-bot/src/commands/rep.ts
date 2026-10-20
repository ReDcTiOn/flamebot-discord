import { EmbedBuilder, Locale, MessageFlags, SlashCommandBuilder, escapeMarkdown } from "discord.js";
import { commandMention } from "./mention.js";
import { formatNumber, prisma } from "@flamebot/core";
import { getState } from "../state.js";
import { event } from "../services/events.js";
import { ensureMember } from "../services/members.js";
import { formatDuration, withLock } from "../util.js";
import { COLORS, type Command } from "./types.js";

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

export const repCommand: Command = {
  data: new SlashCommandBuilder()
    .setName("rep")
    .setNameLocalizations({ [Locale.Russian]: "реп" })
    .setDescription("Дать +1 к репутации игроку")
    .addUserOption((o) => o.setName("игрок").setDescription("Кому дать репутацию").setRequired(true))
    .toJSON(),

  async execute(interaction) {
    const target = interaction.options.getUser("игрок", true);
    const targetMember = interaction.options.getMember("игрок");
    const giver = interaction.user;

    if (target.id === giver.id) {
      await interaction.reply({ content: "Себе репутацию дать нельзя.", flags: MessageFlags.Ephemeral });
      return;
    }
    if (target.bot) {
      await interaction.reply({ content: "Ботам репутация не нужна.", flags: MessageFlags.Ephemeral });
      return;
    }
    if (!targetMember) {
      await interaction.reply({ content: "Этого игрока нет на сервере.", flags: MessageFlags.Ephemeral });
      return;
    }

    const { settings } = await getState();

    // Защита от твинков: свежие участники сервера репутацию не раздают.
    const joinedAt = interaction.member.joinedTimestamp ?? Date.now();
    const minAge = settings.repMinMemberDays * DAY;
    if (Date.now() - joinedAt < minAge) {
      await interaction.reply({
        content: `Давать репутацию можно через ${settings.repMinMemberDays} д. после входа на сервер. Осталось ${formatDuration(minAge - (Date.now() - joinedAt))}.`,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const result = await withLock(`rep:${giver.id}`, async () => {
      const now = Date.now();
      const last = await prisma.repTransaction.findFirst({
        where: { giverId: giver.id, createdAt: { gt: new Date(now - settings.repCooldownHours * HOUR) } },
        orderBy: { createdAt: "desc" },
      });
      if (last) {
        const wait = last.createdAt.getTime() + settings.repCooldownHours * HOUR - now;
        return { ok: false as const, message: `Следующий ${commandMention("rep")} можно дать через ${formatDuration(wait)}.` };
      }

      if (settings.repSameTargetDays > 0) {
        const sameTarget = await prisma.repTransaction.findFirst({
          where: {
            giverId: giver.id,
            receiverId: target.id,
            createdAt: { gt: new Date(now - settings.repSameTargetDays * DAY) },
          },
          orderBy: { createdAt: "desc" },
        });
        if (sameTarget) {
          const wait = sameTarget.createdAt.getTime() + settings.repSameTargetDays * DAY - now;
          return {
            ok: false as const,
            message: `Этому игроку ты уже давал репутацию. Снова можно через ${formatDuration(wait)}.`,
          };
        }
      }

      await ensureMember(giver, interaction.member);
      await ensureMember(target, targetMember);
      const [, receiver] = await prisma.$transaction([
        prisma.repTransaction.create({ data: { giverId: giver.id, receiverId: target.id } }),
        prisma.member.update({ where: { id: target.id }, data: { rep: { increment: 1 } } }),
      ]);
      event("rep.give", `${interaction.member.displayName} дал репутацию ${targetMember.displayName} (теперь ${receiver.rep})`, {
        memberId: target.id,
        details: { giverId: giver.id, total: receiver.rep },
      });
      return { ok: true as const, total: receiver.rep };
    });

    if (!result.ok) {
      await interaction.reply({ content: result.message, flags: MessageFlags.Ephemeral });
      return;
    }

    const embed = new EmbedBuilder()
      .setColor(COLORS.success)
      .setDescription(
        `**${escapeMarkdown(interaction.member.displayName)}** дал репутацию **${escapeMarkdown(targetMember.displayName)}** · теперь ${formatNumber(result.total)} 👍`,
      )
      // В подвале упоминания команд не работают, поэтому без названия команды.
      .setFooter({ text: `Репутацию снова можно дать через ${settings.repCooldownHours} ч` });

    await interaction.reply({ embeds: [embed], allowedMentions: { parse: [] } });
  },
};
