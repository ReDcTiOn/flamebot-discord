import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  GIVEAWAY_MESSAGES,
  GIVEAWAY_MESSAGE_SECTIONS,
  compactGiveawayMessages,
  giveawayMessage,
  giveawayMessageConfig,
  giveawayMessagePlaceholders,
  giveawayMessageSection,
  type GiveawayMessageKey,
} from "../src/giveawayMessages.js";

const settings = (messages: unknown) => ({ messages, promoDmText: GIVEAWAY_MESSAGES.dm.text });

describe("сообщения розыгрышей", () => {
  it("каждое сообщение попадает в один из разделов редактора", () => {
    const keys = Object.keys(GIVEAWAY_MESSAGES) as GiveawayMessageKey[];
    for (const key of keys) assert.ok(GIVEAWAY_MESSAGE_SECTIONS.some((s) => s.key === giveawayMessageSection(key)), key);
    assert.equal(giveawayMessageSection("joinButton"), "card");
    assert.equal(giveawayMessageSection("badDate"), "organizer");
  });

  it("в базе остаются только отличия от стандартных текстов", () => {
    // Старый формат: панель сохраняла все сообщения целиком, даже нетронутые.
    const full = Object.fromEntries(
      (Object.keys(GIVEAWAY_MESSAGES) as GiveawayMessageKey[]).map((k) => [k, { text: GIVEAWAY_MESSAGES[k].text, enabled: true, format: "plain", title: "", color: "#ff5a1f", footer: "" }]),
    );
    full.joined = { ...full.joined!, text: "Записал!" };
    full.everyone = { ...full.everyone!, enabled: false } as never;
    full.dm = { ...full.dm!, format: "embed", title: "Победа" };
    const compact = compactGiveawayMessages(settings(full));
    assert.deepEqual(compact, { everyone: { enabled: false }, joined: { text: "Записал!" }, dm: { format: "embed", title: "Победа" } });
    // Ужатые настройки дают те же сообщения, что и полные.
    for (const key of Object.keys(GIVEAWAY_MESSAGES) as GiveawayMessageKey[]) {
      assert.deepEqual(giveawayMessageConfig(settings(compact), key), giveawayMessageConfig(settings(full), key), key);
    }
  });

  it("стандартный текст берётся, если своего нет, а выключенное сообщение пустое", () => {
    assert.equal(giveawayMessage(settings({}), "joined", { prize: "Кит", relative: "завтра" }), "✅ Ты участвуешь в розыгрыше **Кит**! Итоги завтра. Удачи!");
    assert.equal(giveawayMessage(settings({ everyone: { enabled: false } }), "everyone"), "");
    // Обязательное сообщение выключить нельзя.
    assert.notEqual(giveawayMessage(settings({ closed: { enabled: false } }), "closed"), "");
  });

  it("подстановки сообщения", () => {
    assert.deepEqual(giveawayMessagePlaceholders("claim"), ["prize", "code"]);
    assert.deepEqual(giveawayMessagePlaceholders("joinButton"), []);
  });
});
