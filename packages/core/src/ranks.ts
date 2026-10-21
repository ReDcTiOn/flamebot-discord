export interface RankLike {
  id: number;
  name: string;
  minXp: number;
}

function sorted<T extends RankLike>(ranks: readonly T[]): T[] {
  return [...ranks].sort((a, b) => a.minXp - b.minXp);
}

export function rankForXp<T extends RankLike>(ranks: readonly T[], xp: number): T | null {
  let current: T | null = null;
  for (const rank of sorted(ranks)) {
    if (xp >= rank.minXp) current = rank;
    else break;
  }
  return current;
}

// Самый высокий ранг, роль которого у человека уже есть (null — ни одной роли ранга).
// Нужен, чтобы при переносе опыта никто не оказался ниже роли, которую уже носит.
export function rankFromRoles<T extends RankLike & { roleId: string | null }>(ranks: readonly T[], roleIds: Iterable<string>): T | null {
  const held = new Set(roleIds);
  let best: T | null = null;
  for (const rank of ranks) if (rank.roleId && held.has(rank.roleId) && (!best || rank.minXp > best.minXp)) best = rank;
  return best;
}

export function nextRankForXp<T extends RankLike>(ranks: readonly T[], xp: number): T | null {
  return sorted(ranks).find((r) => r.minXp > xp) ?? null;
}

export interface RankProgress<T extends RankLike> {
  current: T | null;
  next: T | null;
  // Доля пути от текущего ранга к следующему, 0..1. Для последнего ранга 1.
  ratio: number;
}

export function rankProgress<T extends RankLike>(ranks: readonly T[], xp: number): RankProgress<T> {
  const current = rankForXp(ranks, xp);
  const next = nextRankForXp(ranks, xp);
  if (!next) return { current, next, ratio: 1 };
  const from = current?.minXp ?? 0;
  const span = next.minXp - from;
  const ratio = span <= 0 ? 1 : Math.min(1, Math.max(0, (xp - from) / span));
  return { current, next, ratio };
}
