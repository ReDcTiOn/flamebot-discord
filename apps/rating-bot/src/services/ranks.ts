import { escapeMarkdown, type GuildMember, type GuildTextBasedChannel } from "discord.js";
import { formatNumber, prisma, rankForXp, renderTemplate, type Rank, type RatingSettings } from "@flamebot/core";
import { log } from "../logger.js";
import { grantRole, revokeRole } from "./roles.js";

// Приводит роли участника к его рангу и выдаёт награды за новые ранги.
// Возвращает ранг, если участник только что поднялся.
export async function applyRank(
  member: GuildMember,
  memberRow: { xp: number; rankId: number | null; rewardedUpToXp: number },
  settings: RatingSettings,
  ranks: Rank[],
): Promise<{ promotedTo: Rank | null; reward: number }> {
  const target = rankForXp(ranks, memberRow.xp);

  // Награда только за ранги, которые человек ещё не получал.
  const newlyReached = ranks.filter((r) => r.minXp > memberRow.rewardedUpToXp && r.minXp <= memberRow.xp);
  const reward = newlyReached.reduce((sum, r) => sum + r.scrapReward, 0);
  const promoted = newlyReached.length > 0 && target !== null && target.id !== memberRow.rankId;

  if (target?.id !== memberRow.rankId || newlyReached.length > 0) {
    await prisma.member.update({
      where: { id: member.id },
      data: {
        rankId: target?.id ?? null,
        ...(newlyReached.length > 0
          ? { rewardedUpToXp: Math.max(...newlyReached.map((r) => r.minXp)), scrap: { increment: reward } }
          : {}),
      },
    });
  }

  await syncRankRoles(member, target, settings, ranks);
  return { promotedTo: promoted ? target : null, reward };
}

export async function syncRankRoles(member: GuildMember, target: Rank | null, settings: RatingSettings, ranks: Rank[]) {
  const reason = "Scrap Rank: роль ранга";
  try {
    if (target?.roleId) await grantRole(member, target.roleId, reason);
    if (settings.removeOldRankRoles) {
      for (const rank of ranks) {
        if (rank.roleId && rank.roleId !== target?.roleId) await revokeRole(member, rank.roleId, reason);
      }
    }
  } catch (err) {
    log.warn(`Не удалось обновить роли ранга у ${member.id}`, err);
  }
}

export async function announceRankUp(
  member: GuildMember,
  rank: Rank,
  reward: number,
  settings: RatingSettings,
  fallback: GuildTextBasedChannel | null,
) {
  if (!settings.announceRankUp) return;
  const channel =
    (settings.announceChannelId ? member.guild.channels.cache.get(settings.announceChannelId) : null) ?? fallback;
  if (!channel || !channel.isTextBased() || !channel.isSendable()) return;

  const text = renderTemplate(settings.rankUpMessage, {
    user: `<@${member.id}>`,
    name: escapeMarkdown(member.displayName),
    rank: `${rank.emoji ? rank.emoji + " " : ""}${escapeMarkdown(rank.name)}`,
    reward: formatNumber(reward),
  });

  try {
    // Упоминать можно только самого игрока: шаблон пишет админ, но @everyone из него не сработает.
    await channel.send({ content: text.slice(0, 2000), allowedMentions: { users: [member.id] } });
  } catch (err) {
    log.warn("Не удалось отправить объявление о ранге", err);
  }
}
