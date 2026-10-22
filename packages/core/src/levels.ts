// Уровни как в JuniperBot: с уровня N на N+1 нужно 5·N² + 50·N + 100 опыта (та же формула, что у MEE6).
// Уровень 1 — 100 опыта, 5 — 1 150, 10 — 4 675, 20 — 23 850, 30 — 67 525.

export const MAX_LEVEL = 999;

// Сколько опыта нужно, чтобы перейти с уровня `level` на следующий.
export const levelExp = (level: number) => 5 * level * level + 50 * level + 100;

// Сколько всего опыта нужно, чтобы достичь уровня `level`.
export function levelTotalExp(level: number): number {
  const n = Math.max(0, Math.min(MAX_LEVEL, Math.floor(level)));
  // Сумма levelExp(i) для i от 0 до n-1.
  return (5 * (n - 1) * n * (2 * n - 1)) / 6 + (50 * (n - 1) * n) / 2 + 100 * n;
}

export function levelFromExp(exp: number): number {
  let level = 0;
  let left = exp;
  while (level < MAX_LEVEL && left >= levelExp(level)) {
    left -= levelExp(level);
    level++;
  }
  return level;
}

export interface LevelProgress {
  level: number;
  // Опыт внутри текущего уровня и сколько нужно на весь уровень.
  into: number;
  need: number;
  ratio: number;
}

export function levelProgress(exp: number): LevelProgress {
  const level = levelFromExp(exp);
  const into = Math.max(0, exp - levelTotalExp(level));
  const need = levelExp(level);
  return { level, into, need, ratio: Math.min(1, into / need) };
}
