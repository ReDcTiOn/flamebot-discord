import type { Db } from "./db.js";
import { rankForXp } from "./ranks.js";

// Награды за ранги задним числом. Перенос из JuniperBot и проверка участников отмечают ранги
// как пройденные, но скрап за них не начисляют. Здесь каждый получает сумму наград за все
// пройденные ранги за вычетом того, что бот уже выплатил сам (события rank.up)
// и что уже выдано этой кнопкой раньше. Повторная выдача даёт только разницу.

export interface RankRewardLike {
  id: number;
  name: string;
  minXp: number;
  scrapReward: number;
}

export interface RankScrapRow {
  id: string;
  rankId: number | null;
  owed: number;
  reachedMinXp: number;
}

export function rankScrapOwed(
  ranks: readonly RankRewardLike[],
  member: { xp: number; rankScrapGranted: number },
  paidByBot: number,
): { owed: number; reachedMinXp: number } {
  const reached = ranks.filter((r) => r.minXp <= member.xp);
  const total = reached.reduce((sum, r) => sum + r.scrapReward, 0);
  const reachedMinXp = reached.reduce((max, r) => Math.max(max, r.minXp), 0);
  return { owed: Math.max(0, total - paidByBot - member.rankScrapGranted), reachedMinXp };
}

export interface RankScrapPlan {
  rows: RankScrapRow[];
  total: number;
  // Пока бот проверяет перенесённых участников, их опыт и ранги ещё могут вырасти.
  pendingChecks: number;
  byRank: { rankId: number; name: string; members: number; scrap: number }[];
}

export async function planRankScrapGrant(db: Db): Promise<RankScrapPlan> {
  const ranks = await db.rank.findMany({ orderBy: { minXp: "asc" }, select: { id: true, name: true, minXp: true, scrapReward: true } });
  const first = ranks[0];
  const [members, events, pendingChecks] = await Promise.all([
    first
      ? db.member.findMany({ where: { xp: { gte: first.minXp } }, select: { id: true, xp: true, rankScrapGranted: true } })
      : Promise.resolve([]),
    db.botEvent.findMany({ where: { type: "rank.up", memberId: { not: null } }, select: { memberId: true, details: true } }),
    db.member.count({ where: { needsMemberCheck: true } }),
  ]);

  const paid = new Map<string, number>();
  for (const e of events) {
    const reward = Number((e.details as { reward?: unknown } | null)?.reward ?? 0);
    if (e.memberId && Number.isFinite(reward) && reward > 0) paid.set(e.memberId, (paid.get(e.memberId) ?? 0) + reward);
  }

  const rows: RankScrapRow[] = [];
  const byRank = new Map<number, { rankId: number; name: string; members: number; scrap: number }>();
  for (const m of members) {
    const { owed, reachedMinXp } = rankScrapOwed(ranks, m, paid.get(m.id) ?? 0);
    if (owed <= 0) continue;
    const rank = rankForXp(ranks, m.xp);
    rows.push({ id: m.id, rankId: rank?.id ?? null, owed, reachedMinXp });
    if (rank) {
      const g = byRank.get(rank.id) ?? { rankId: rank.id, name: rank.name, members: 0, scrap: 0 };
      g.members++;
      g.scrap += owed;
      byRank.set(rank.id, g);
    }
  }
  return {
    rows,
    total: rows.reduce((s, r) => s + r.owed, 0),
    pendingChecks,
    byRank: ranks.flatMap((r) => (byRank.has(r.id) ? [byRank.get(r.id)!] : [])),
  };
}

// Начисляет посчитанное. Ранги за выданное отмечаются полученными, чтобы бот не выдал их второй раз.
export async function applyRankScrapGrant(db: Db, plan: RankScrapPlan): Promise<{ members: number; total: number }> {
  for (let i = 0; i < plan.rows.length; i += 200) {
    const chunk = plan.rows.slice(i, i + 200);
    await db.$transaction(
      chunk.flatMap((r) => [
        db.member.update({
          where: { id: r.id },
          data: { scrap: { increment: r.owed }, rankScrapGranted: { increment: r.owed } },
        }),
        // Порог только поднимаем: бот мог успеть выдать ранг выше, пока шла выдача.
        db.member.updateMany({ where: { id: r.id, rewardedUpToXp: { lt: r.reachedMinXp } }, data: { rewardedUpToXp: r.reachedMinXp } }),
      ]),
    );
  }
  return { members: plan.rows.length, total: plan.total };
}
