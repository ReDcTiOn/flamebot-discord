import { DiscordAPIError, RESTJSONErrorCodes, type Guild } from "discord.js";
import { prisma, rankForXp, rankFromRoles } from "@flamebot/core";
import { log } from "../logger.js";
import { getState } from "../state.js";
import { applyRank } from "./ranks.js";
import { expireOldRequests } from "./customRoles.js";
import { event } from "./events.js";
import { revokeRole } from "./roles.js";
import { processVoice } from "./voice.js";

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
      event("purchase.expired", `Закончился срок «${p.item.name}»${p.customName ? ` («${p.customName}»)` : ""}, роль снята`, {
        memberId: p.memberId,
        details: { purchaseId: p.id, item: p.item.name },
      });
    } catch (err) {
      log.warn(`Не удалось завершить покупку #${p.id}`, err);
    }
  }
}

// Пересчитывает роли тех, кому панель поменяла опыт или кому изменили ранги.
export async function processRoleSyncQueue(guild: Guild): Promise<void> {
  // Сначала проверка участника подтягивает опыт до роли ранга, которая у человека уже есть, — потом роли.
  const queue = await prisma.member.findMany({ where: { needsRoleSync: true, needsMemberCheck: false }, take: 25 });
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

// Проверяет участников, перенесённых из другого бота: ушедших отмечает, остальным обновляет имя
// и подтягивает опыт до порога самой высокой роли ранга, которая у них уже есть, — чтобы все
// остались при своих ролях. Роли в Discord не меняет, награды за ранги не выдаёт.
export async function processMemberChecks(guild: Guild): Promise<void> {
  const queue = await prisma.member.findMany({
    where: { needsMemberCheck: true },
    select: { id: true, xp: true, rewardedUpToXp: true },
    take: 50,
  });
  if (queue.length === 0) return;
  const { ranks } = await getState();
  let raised = 0;
  for (const row of queue) {
    try {
      const member = await guild.members.fetch(row.id).catch((e) => (isUnknownMember(e) ? null : Promise.reject(e)));
      if (!member) {
        await prisma.member.update({ where: { id: row.id }, data: { needsMemberCheck: false, inGuild: false } });
        continue;
      }
      const byRole = rankFromRoles(ranks, member.roles.cache.keys());
      const xp = Math.max(row.xp, byRole?.minXp ?? 0);
      const rank = rankForXp(ranks, xp);
      if (xp > row.xp) raised++;
      await prisma.member.update({
        where: { id: row.id },
        data: {
          needsMemberCheck: false,
          inGuild: true,
          username: member.user.username.slice(0, 64),
          displayName: member.displayName.slice(0, 64),
          avatarHash: member.user.avatar,
          xp,
          rankId: rank?.id ?? null,
          rewardedUpToXp: Math.max(row.rewardedUpToXp, rank?.minXp ?? 0),
        },
      });
    } catch (err) {
      log.warn(`Не удалось проверить участника ${row.id}`, err);
    }
  }
  if (raised) {
    const who = raised % 10 === 1 && raised % 100 !== 11 ? "участника" : "участников";
    event("rank.import", `Перенос опыта: у ${raised} ${who} опыт поднят до порога роли ранга, которая у них уже есть`, { details: { raised } });
  }
}

// Обычные события храним 90 дней, предупреждения и ошибки — 180.
export async function cleanupEvents(): Promise<void> {
  const day = 86_400_000;
  await prisma.botEvent.deleteMany({ where: { level: "INFO", createdAt: { lt: new Date(Date.now() - 90 * day) } } });
  await prisma.botEvent.deleteMany({ where: { createdAt: { lt: new Date(Date.now() - 180 * day) } } });
}

export function startJobs(guild: Guild, every: (fn: () => Promise<void>, ms: number) => void): void {
  every(() => expirePurchases(guild), 5 * 60_000);
  every(() => processRoleSyncQueue(guild), 30_000);
  every(() => processMemberChecks(guild), 30_000);
  every(() => processVoice(guild), 60_000);
  every(() => expireOldRequests(guild), 30 * 60_000);
  every(cleanupEvents, 24 * 3_600_000);
}
