import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  LINK_CODE_ALPHABET,
  LINK_CODE_LENGTH,
  STEAM_ID,
  cleanSteamName,
  generateLinkCode,
  generateLinkKey,
  hashLinkKey,
  linkKeyHint,
  linkSettingsSchema,
  normalizeLinkCode,
} from "../src/link.js";

describe("привязка: код из игры", () => {
  it("код из нужных символов и нужной длины", () => {
    for (let i = 0; i < 200; i++) {
      const code = generateLinkCode();
      assert.equal(code.length, LINK_CODE_LENGTH);
      for (const ch of code) assert.ok(LINK_CODE_ALPHABET.includes(ch), `лишний символ ${ch}`);
    }
  });

  it("в алфавите нет похожих символов", () => {
    for (const ch of "01OIL") assert.ok(!LINK_CODE_ALPHABET.includes(ch));
  });

  it("понимает код в любом регистре, с пробелами и дефисами", () => {
    assert.equal(normalizeLinkCode("k7mq2p"), "K7MQ2P");
    assert.equal(normalizeLinkCode(" K7M-Q2P "), "K7MQ2P");
    assert.equal(normalizeLinkCode("k7m q2p"), "K7MQ2P");
  });

  it("отбрасывает то, что не может быть кодом", () => {
    assert.equal(normalizeLinkCode(""), null);
    assert.equal(normalizeLinkCode("K7MQ2"), null);
    assert.equal(normalizeLinkCode("K7MQ2PP"), null);
    assert.equal(normalizeLinkCode("K0MQ2P"), null);
    assert.equal(normalizeLinkCode("К7МQ2Р"), null); // кириллица
  });
});

describe("привязка: SteamID и ник", () => {
  it("принимает только SteamID64", () => {
    assert.ok(STEAM_ID.test("76561198000000000"));
    assert.ok(!STEAM_ID.test("7656119800000000"));
    assert.ok(!STEAM_ID.test("12345678901234567"));
    assert.ok(!STEAM_ID.test("76561198000000000 "));
  });

  it("чистит ник из игры", () => {
    assert.equal(cleanSteamName("  Player\u0000One  "), "PlayerOne");
    assert.equal(cleanSteamName("<color=red>Red</color>"), "Red");
    assert.equal(cleanSteamName("   "), "Без имени");
    assert.equal(cleanSteamName("x".repeat(100)).length, 64);
  });
});

describe("привязка: ключ сервера", () => {
  it("ключ случайный, с префиксом, хеш не зависит от пробелов вокруг", () => {
    const a = generateLinkKey();
    const b = generateLinkKey();
    assert.notEqual(a, b);
    assert.ok(a.startsWith("flk_"));
    assert.ok(a.length > 40);
    assert.equal(hashLinkKey(a), hashLinkKey(` ${a}\n`));
    assert.notEqual(hashLinkKey(a), hashLinkKey(b));
    assert.match(hashLinkKey(a), /^[0-9a-f]{64}$/);
  });

  it("подсказка не раскрывает ключ", () => {
    const key = generateLinkKey();
    const hint = linkKeyHint(key);
    assert.ok(hint.length < 12);
    assert.ok(key.startsWith(hint.slice(0, -1)));
  });
});

describe("привязка: настройки", () => {
  const valid = {
    channelId: "123456789012345678",
    roleId: null,
    codeTtlMinutes: 10,
    panelTitle: "Привязка",
    panelText: "Текст",
    buttonLabel: "Привязать",
  };

  it("принимает нормальные настройки", () => {
    assert.ok(linkSettingsSchema.safeParse(valid).success);
  });

  it("ограничивает срок кода и длину подписи кнопки", () => {
    assert.ok(!linkSettingsSchema.safeParse({ ...valid, codeTtlMinutes: 1 }).success);
    assert.ok(!linkSettingsSchema.safeParse({ ...valid, codeTtlMinutes: 61 }).success);
    assert.ok(!linkSettingsSchema.safeParse({ ...valid, buttonLabel: "x".repeat(81) }).success);
    assert.ok(!linkSettingsSchema.safeParse({ ...valid, channelId: "abc" }).success);
  });
});
