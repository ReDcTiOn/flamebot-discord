import { DiscordAPIError, RESTJSONErrorCodes, type Guild } from "discord.js";
import { prisma, rankForXp } from "@flamebot/core";
import { log } from "../logger.js";
import { getState } from "../state.js";
import { applyRank } from "./ranks.js";
import { revokeRole } from "./roles.js";

function isUnknownMember(err: unknown): boolean {
  return err instanceof DiscordAPIError && err.code === RESTJSONErrorCodes.UnknownMember;
}

// Снимает роли у истёкших покупок.
export async function expirePurchases(guild: Guild): Promise<void> {
  const expired = await prisma.purchase.findMany({
    where: { active: true, expiresAt: { lte: new Date() } },
    include: { item: true },
    take: 50,
  });

  for (const p of expired) {
    try {
      if (p.roleId) {
        if (p.item.type === "CUSTOM_ROLE") {
          const role = guild.roles.cache.get(p.roleId);
          if (role?.editable) await role.delete("Scrap Rank: срок личной роли истёк");
        } else {
          const member = await guild.members.fetch(p.memberId).catch((e) => (isUnknownMember(e) ? null : Promise.reject(e)));
          if (member) await revokeRole(member, p.roleId, "Scrap Rank: срок покупки истёк");
        }
      }
      await prisma.purchase.update({ where: { id: p.id }, data: { active: false } });
    } catch (err) {
      log.warn(`Не удалось завершить покупку #${p.id}`, err);
    }
  }
}

// Пересчитывает роли тех, кому панель поменяла опыт или кому изменили ранги.
export async function processRoleSyncQueue(guild: Guild): Promise<void> {
  const queue = await prisma.member.findMany({ where: { needsRoleSync: true }, take: 25 });
  if (queue.length === 0) return;
  const { settings, ranks } = await getState();

  for (const row of queue) {
    try {
      const member = await guild.members.fetch(row.id).catch((e) => (isUnknownMember(e) ? null : Promise.reject(e)));
      if (!member) {
        await prisma.member.update({ where: { id: row.id }, data: { needsRoleSync: false, inGuild: false } });
        continue;
      }
      // Награды за ранги при ручной правке опыта не выдаём, только приводим роли и ранг в порядок.
      await applyRank(member, { ...row, rewardedUpToXp: Math.max(row.rewardedUpToXp, row.xp) }, settings, ranks);
      // Ранги, до которых довела ручная правка, считаем уже «оплаченными»,
      // чтобы награда не прилетела неожиданно со следующим сообщением.
      const target = rankForXp(ranks, row.xp);
      await prisma.member.update({
        where: { id: row.id },
        data: {
          needsRoleSync: false,
          rankId: target?.id ?? null,
          rewardedUpToXp: Math.max(row.rewardedUpToXp, target?.minXp ?? 0),
        },
      });
    } catch (err) {
      log.warn(`Не удалось пересчитать роли у ${row.id}`, err);
    }
  }
}

export function startJobs(guild: Guild, every: (fn: () => Promise<void>, ms: number) => void): void {
  every(() => expirePurchases(guild), 5 * 60_000);
  every(() => processRoleSyncQueue(guild), 30_000);
}
