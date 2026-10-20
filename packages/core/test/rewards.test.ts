import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { round2 } from "../src/db.js";
import { messageReward, randomHundredths } from "../src/rewards.js";
import { rankSchema, xpSettingsSchema } from "../src/settings.js";
import { formatNumber } from "../src/util.js";

const settings = { xpMin: 15, xpMax: 25, scrapPerAward: 2 };
const plain = { xpMin: null, xpMax: null, scrapPerMessage: null };

describe("начисление за сообщение", () => {
  it("без своих значений у ранга берёт общие настройки", () => {
    assert.deepEqual(messageReward(settings, plain), { xpMin: 15, xpMax: 25, scrap: 2 });
    assert.deepEqual(messageReward(settings, null), { xpMin: 15, xpMax: 25, scrap: 2 });
  });

  it("берёт значения ранга, в том числе сотые и ноль", () => {
    assert.deepEqual(messageReward(settings, { xpMin: 0.01, xpMax: 0.05, scrapPerMessage: 0 }), { xpMin: 0.01, xpMax: 0.05, scrap: 0 });
    assert.deepEqual(messageReward(settings, { xpMin: null, xpMax: null, scrapPerMessage: 0.5 }), { xpMin: 15, xpMax: 25, scrap: 0.5 });
  });

  it("случайное значение — в диапазоне и с шагом 0.01", () => {
    for (let i = 0; i < 2000; i++) {
      const v = randomHundredths(0.01, 0.05);
      assert.ok(v >= 0.01 && v <= 0.05, String(v));
      assert.equal(Math.round(v * 100) / 100, v);
    }
    assert.equal(randomHundredths(3, 3), 3);
  });

  it("сотые складываются без ошибок округления", () => {
    let sum = 0;
    for (let i = 0; i < 100; i++) sum = round2(sum + 0.01);
    assert.equal(sum, 1);
    assert.equal(round2(0.1 + 0.2), 0.3);
  });

  it("форматирует до двух знаков", () => {
    assert.equal(formatNumber(0.01), "0,01");
    assert.equal(formatNumber(1245.5), "1 245,5");
    assert.equal(formatNumber(16480), "16 480");
  });
});

describe("проверка настроек", () => {
  const base = { xpCooldownSec: 60, minMessageLength: 5, announceRankUp: true, removeOldRankRoles: true };
  it("общие настройки принимают сотые и не принимают тысячные", () => {
    assert.equal(xpSettingsSchema.safeParse({ ...base, xpMin: 0.01, xpMax: 0.02, scrapPerAward: 0.01 }).success, true);
    assert.equal(xpSettingsSchema.safeParse({ ...base, xpMin: 0.001, xpMax: 0.02, scrapPerAward: 0 }).success, false);
  });

  const rank = { name: "Камень", emoji: null, minXp: 4000, roleId: null, scrapReward: 150 };
  it("у ранга опыт «от» и «до» задаются вместе", () => {
    assert.equal(rankSchema.safeParse({ ...rank, ...plain }).success, true);
    assert.equal(rankSchema.safeParse({ ...rank, xpMin: 0.5, xpMax: 1.25, scrapPerMessage: 0.1 }).success, true);
    assert.equal(rankSchema.safeParse({ ...rank, xpMin: 1, xpMax: null, scrapPerMessage: null }).success, false);
    assert.equal(rankSchema.safeParse({ ...rank, xpMin: 2, xpMax: 1, scrapPerMessage: null }).success, false);
  });
});
