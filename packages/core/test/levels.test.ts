import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { levelExp, levelFromExp, levelProgress, levelTotalExp } from "../src/levels.js";

describe("уровни как в JuniperBot", () => {
  it("опыт уровней совпадает с формулой JuniperBot", () => {
    assert.deepEqual([0, 1, 2, 10].map(levelExp), [100, 155, 220, 1100]);
    assert.deepEqual([0, 1, 2, 5, 10, 20, 30, 36].map(levelTotalExp), [0, 100, 255, 1150, 4675, 23850, 67525, 109650]);
    // Сумма по шагам совпадает с формулой для всех уровней.
    let sum = 0;
    for (let l = 0; l < 200; l++) {
      assert.equal(levelTotalExp(l), sum);
      sum += levelExp(l);
    }
  });

  it("уровень по опыту — как в выгрузке JuniperBot", () => {
    assert.equal(levelFromExp(0), 0);
    assert.equal(levelFromExp(99), 0);
    assert.equal(levelFromExp(100), 1);
    assert.equal(levelFromExp(110946), 36);
    assert.equal(levelFromExp(17214), 17);
  });

  it("прогресс внутри уровня", () => {
    assert.deepEqual(levelProgress(1150 + 238), { level: 5, into: 238, need: 475, ratio: 238 / 475 });
  });
});
