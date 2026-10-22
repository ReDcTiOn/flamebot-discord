import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { rankScrapOwed } from "../src/rankScrap.js";

const ranks = [
  { id: 1, name: "Фармила", minXp: 1150, scrapReward: 500 },
  { id: 2, name: "Билдер", minXp: 4675, scrapReward: 1000 },
  { id: 3, name: "Стрелок", minXp: 23850, scrapReward: 1500 },
  { id: 4, name: "Рейдер", minXp: 67525, scrapReward: 2000 },
];

describe("награды за ранги задним числом", () => {
  it("складывает награды за все пройденные ранги", () => {
    assert.deepEqual(rankScrapOwed(ranks, { xp: 70_000, rankScrapGranted: 0 }, 0), { owed: 5000, reachedMinXp: 67525 });
    assert.deepEqual(rankScrapOwed(ranks, { xp: 1000, rankScrapGranted: 0 }, 0), { owed: 0, reachedMinXp: 0 });
  });

  it("не выдаёт второй раз то, что бот уже выплатил или выдано раньше", () => {
    // Бот сам выдал за Фармилу и Билдера.
    assert.equal(rankScrapOwed(ranks, { xp: 30_000, rankScrapGranted: 0 }, 1500).owed, 1500);
    // Повторная выдача после первой — ноль, после нового ранга — только разница.
    assert.equal(rankScrapOwed(ranks, { xp: 30_000, rankScrapGranted: 3000 }, 0).owed, 0);
    assert.equal(rankScrapOwed(ranks, { xp: 70_000, rankScrapGranted: 3000 }, 0).owed, 2000);
  });
});
