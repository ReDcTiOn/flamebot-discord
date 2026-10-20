import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { DEFAULT_CARD_LAYOUT, cardAssetIds, cardLayoutSchema, fillPlaceholders, stripEmoji, type CardData } from "../src/card/index.js";

const data: CardData = {
  name: "Kreed",
  username: "kreed",
  rank: "Камень",
  nextRank: "Металл",
  xp: 5230,
  nextXp: 8000,
  progress: 0.31,
  scrap: 1245,
  rep: 38,
  messages: 117,
  place: 7,
  server: "FLAME RUST",
  badges: [],
};

describe("карточка профиля", () => {
  it("стандартный шаблон проходит свою же схему", () => {
    assert.equal(cardLayoutSchema.safeParse(DEFAULT_CARD_LAYOUT).success, true);
    assert.equal(new Set(DEFAULT_CARD_LAYOUT.elements.map((e) => e.id)).size, DEFAULT_CARD_LAYOUT.elements.length);
  });

  it("подставляет значения и пишет «максимальный ранг» на последнем ранге", () => {
    assert.equal(fillPlaceholders("{name}: {xp} / {next_xp}", data), "Kreed: 5 230 / 8 000");
    assert.equal(fillPlaceholders("{next_info}", data), "до «Металл»: 2 770");
    assert.equal(fillPlaceholders("{next_info}", { ...data, nextXp: null }), "максимальный ранг");
    assert.equal(fillPlaceholders("{unknown} {constructor}", data), "{unknown} {constructor}");
  });

  it("убирает эмодзи, которые нельзя нарисовать без отдельного шрифта", () => {
    assert.equal(stripEmoji("🪨 Камень"), "Камень");
    assert.equal(stripEmoji("⚙️ Металл"), "Металл");
  });

  it("отклоняет опасные и сломанные шаблоны", () => {
    const bad = (patch: object) => cardLayoutSchema.safeParse({ ...DEFAULT_CARD_LAYOUT, ...patch }).success;
    assert.equal(bad({ width: 100_000 }), false);
    assert.equal(bad({ background: { ...DEFAULT_CARD_LAYOUT.background, color: "red; drop table" } }), false);
    assert.equal(bad({ elements: Array.from({ length: 41 }, () => DEFAULT_CARD_LAYOUT.elements[0]) }), false);
    const text = { ...DEFAULT_CARD_LAYOUT.elements.find((e) => e.type === "text")!, text: "x".repeat(201) };
    assert.equal(bad({ elements: [text] }), false);
  });

  it("собирает картинки, на которые ссылается шаблон", () => {
    const layout = {
      ...DEFAULT_CARD_LAYOUT,
      background: { ...DEFAULT_CARD_LAYOUT.background, imageAssetId: 3 },
      elements: [
        ...DEFAULT_CARD_LAYOUT.elements,
        { id: "logo", name: "Лого", type: "image" as const, visible: true, x: 0, y: 0, opacity: 1, width: 10, height: 10, radius: 0, assetId: 5, fit: "contain" as const },
      ],
    };
    assert.deepEqual(cardAssetIds(layout).sort(), [3, 5]);
  });
});
