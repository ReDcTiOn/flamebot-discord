import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { PROFILE_TEXT_DEFAULTS, profileTexts, purchasesBlock } from "../src/card/index.js";

describe("тексты под карточкой профиля", () => {
  it("собирает список покупок с метками времени Discord", () => {
    const at = new Date("2026-11-05T12:00:00Z");
    const ts = Math.floor(at.getTime() / 1000);
    const block = purchasesBlock(profileTexts({}), [
      { item: "Цвет ника", price: 500, expiresAt: at, pending: false },
      { item: "Личная роль «Король»", price: 3000, expiresAt: null, pending: true },
      { item: "Бейдж", price: 100, expiresAt: null, pending: false },
    ]);
    assert.equal(
      block,
      [
        "### :flamerust_coins: Покупки",
        `**Цвет ника** – до <t:${ts}:D>, <t:${ts}:R>`,
        "**Личная роль «Король»** – на проверке у администрации",
        "**Бейдж** – навсегда",
        "-# Купить ещё – /shop",
      ].join("\n"),
    );
  });

  it("без покупок пишет пустой текст, пустые строки пропускает", () => {
    assert.equal(purchasesBlock({ ...PROFILE_TEXT_DEFAULTS, footer: "", purchasesTitle: "Покупки" }, []), "Покупки\nПокупок нет. Загляни в /shop");
  });

  it("берёт из базы только правильные поля", () => {
    const t = profileTexts({ itemForever: "{item} — навсегда", itemTimed: "", empty: 5, junk: "x" });
    assert.equal(t.itemForever, "{item} — навсегда");
    assert.equal(t.itemTimed, PROFILE_TEXT_DEFAULTS.itemTimed);
    assert.equal(t.empty, PROFILE_TEXT_DEFAULTS.empty);
    assert.equal("junk" in t, false);
  });
});
