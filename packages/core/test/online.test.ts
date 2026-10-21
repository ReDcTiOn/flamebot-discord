import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { formatDowntime, onlineTelegramSchema, onlineTelegramText, parseTelegramChats, telegramTokenHint, telegramTokenSchema } from "../src/online.js";

describe("уведомления онлайна в Telegram", () => {
  it("длительность простоя", () => {
    assert.equal(formatDowntime(45_000), "45 с");
    assert.equal(formatDowntime(12 * 60_000 + 20_000), "12 мин");
    assert.equal(formatDowntime(2 * 3_600_000), "2 ч");
    assert.equal(formatDowntime(2 * 3_600_000 + 5 * 60_000), "2 ч 5 мин");
    assert.equal(formatDowntime(3 * 86_400_000 + 4 * 3_600_000), "3 д 4 ч");
    assert.equal(formatDowntime(-5), "0 с");
  });

  it("подстановки в тексте", () => {
    assert.equal(
      onlineTelegramText("🟢 {server}: {players}/{max}, лежал {downtime}", { server: "FR #1", downtime: "5 мин", players: 10, max: 200 }),
      "🟢 FR #1: 10/200, лежал 5 мин",
    );
    assert.equal(onlineTelegramText("🔴 {server} {downtime}", { server: "FR #2" }), "🔴 FR #2 ");
  });

  it("список чатов", () => {
    assert.deepEqual(parseTelegramChats("123, -100456\n@flame_news  123"), ["123", "-100456", "@flame_news"]);
    const base = { notifyOffline: true, notifyOnline: true, delaySec: 60, offlineText: "a", onlineText: "b" };
    assert.ok(onlineTelegramSchema.safeParse({ ...base, chatIds: ["123", "-100456", "@flame_news"] }).success);
    assert.ok(!onlineTelegramSchema.safeParse({ ...base, chatIds: ["abc"] }).success);
    assert.ok(!onlineTelegramSchema.safeParse({ ...base, chatIds: [], delaySec: 4000 }).success);
  });

  it("токен и подсказка без секрета", () => {
    const token = "123456789:AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsaw0";
    assert.ok(telegramTokenSchema.safeParse(token).success);
    assert.ok(!telegramTokenSchema.safeParse("123:short").success);
    const hint = telegramTokenHint(token);
    assert.equal(hint, "бот 123456789, …saw0");
    assert.ok(!hint.includes("AAHdq"));
  });
});
