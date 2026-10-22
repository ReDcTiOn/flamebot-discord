import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { checkRoleSafeToGrant, Perm } from "../src/permissions.js";
import { nextRankForXp, rankForXp, rankFromRoles, rankProgress } from "../src/ranks.js";
import { xpSettingsSchema } from "../src/settings.js";
import { renderTemplate } from "../src/util.js";

const ranks = [
  { id: 3, name: "Камень", minXp: 4000 },
  { id: 1, name: "Голый", minXp: 0 },
  { id: 2, name: "Солома", minXp: 500 },
];

describe("ранги", () => {
  it("выбирает ранг по опыту независимо от порядка", () => {
    assert.equal(rankForXp(ranks, 0)?.name, "Голый");
    assert.equal(rankForXp(ranks, 499)?.name, "Голый");
    assert.equal(rankForXp(ranks, 500)?.name, "Солома");
    assert.equal(rankForXp(ranks, 999_999)?.name, "Камень");
  });

  it("находит следующий ранг и прогресс", () => {
    assert.equal(nextRankForXp(ranks, 600)?.name, "Камень");
    assert.equal(nextRankForXp(ranks, 4000), null);
    const p = rankProgress(ranks, 2250);
    assert.equal(p.current?.name, "Солома");
    assert.equal(p.ratio, 0.5);
    assert.equal(rankProgress(ranks, 5000).ratio, 1);
  });

  it("без рангов не падает", () => {
    assert.equal(rankForXp([], 100), null);
    assert.equal(rankProgress([], 100).ratio, 1);
  });
});

describe("безопасность ролей", () => {
  const guildId = "111111111111111111";
  const role = (permissions: bigint, managed = false, id = "222222222222222222") => ({ id, permissions, managed });

  it("пропускает обычную роль", () => {
    assert.deepEqual(checkRoleSafeToGrant(role(0n), guildId), { ok: true });
  });

  it("не даёт выдать роль с правами администратора или модерации", () => {
    for (const bit of [Perm.Administrator, Perm.BanMembers, Perm.ManageRoles, Perm.ModerateMembers, Perm.MentionEveryone]) {
      assert.equal(checkRoleSafeToGrant(role(bit), guildId).ok, false);
    }
  });

  it("не даёт выдать @everyone, служебные и несуществующие роли", () => {
    assert.equal(checkRoleSafeToGrant(role(0n, false, guildId), guildId).ok, false);
    assert.equal(checkRoleSafeToGrant(role(0n, true), guildId).ok, false);
    assert.equal(checkRoleSafeToGrant(null, guildId).ok, false);
  });

  it("читает права из строки и не верит мусору", () => {
    assert.equal(checkRoleSafeToGrant({ id: "3".repeat(18), permissions: "8", managed: false }, guildId).ok, false);
    assert.equal(checkRoleSafeToGrant({ id: "3".repeat(18), permissions: "abc", managed: false }, guildId).ok, true);
  });
});

describe("шаблоны и настройки", () => {
  it("подставляет только известные плейсхолдеры", () => {
    assert.equal(renderTemplate("{user} → {rank} {unknown}", { user: "A", rank: "B" }), "A → B {unknown}");
    assert.equal(renderTemplate("{constructor}", {}), "{constructor}");
  });

  it("не принимает минимум опыта больше максимума", () => {
    const base = { xpMin: 30, xpMax: 10, xpCooldownSec: 60, minMessageLength: 5, scrapPerAward: 2, voiceXpEnabled: true, voiceXpPerMember: 6, announceRankUp: true, removeOldRankRoles: true };
    assert.equal(xpSettingsSchema.safeParse(base).success, false);
    assert.equal(xpSettingsSchema.safeParse({ ...base, xpMax: 40 }).success, true);
    assert.equal(xpSettingsSchema.safeParse({ ...base, xpMax: 40, xpCooldownSec: 1 }).success, false);
  });
});

describe("ранг по ролям", () => {
  const ranks = [
    { id: 1, name: "Фармила", minXp: 50, roleId: "r1" },
    { id: 2, name: "Билдер", minXp: 100, roleId: "r2" },
    { id: 3, name: "Без роли", minXp: 300, roleId: null },
  ];
  it("берёт самую высокую роль ранга и игнорирует остальные роли", () => {
    assert.equal(rankFromRoles(ranks, ["x", "r1", "r2"])?.name, "Билдер");
    assert.equal(rankFromRoles(ranks, ["r1"])?.name, "Фармила");
    assert.equal(rankFromRoles(ranks, ["x"]), null);
  });
});
