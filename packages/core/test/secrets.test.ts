import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { discordTokenSchema, isPrivateAddress, onlineHost, onlineStatusText } from "../src/online.js";
import { generateSecretKeyPair, loadPrivateKey, openSecret, sealSecret, secretContext } from "../src/secrets.js";

describe("шифрование секретов", () => {
  const pair = generateSecretKeyPair();
  const { key, publicKey } = loadPrivateKey(pair.privateKey);
  const ctx = secretContext("online", 5, "discordToken");

  it("открытый ключ выводится из приватного", () => {
    assert.equal(publicKey, pair.publicKey);
  });

  it("расшифровывается своим ключом и контекстом", () => {
    const sealed = sealSecret(publicKey, "секретный токен", ctx);
    assert.notEqual(sealed.includes("секретный"), true);
    assert.equal(openSecret(key, sealed, ctx), "секретный токен");
  });

  it("каждый раз разный шифротекст", () => {
    assert.notEqual(sealSecret(publicKey, "x", ctx), sealSecret(publicKey, "x", ctx));
  });

  it("не расшифровывается в чужом поле или для другого сервера", () => {
    const sealed = sealSecret(publicKey, "token", ctx);
    assert.throws(() => openSecret(key, sealed, secretContext("online", 5, "rconPassword")));
    assert.throws(() => openSecret(key, sealed, secretContext("online", 6, "discordToken")));
  });

  it("не расшифровывается чужим ключом и замечает подделку", () => {
    const sealed = sealSecret(publicKey, "token", ctx);
    const other = loadPrivateKey(generateSecretKeyPair().privateKey).key;
    assert.throws(() => openSecret(other, sealed, ctx));
    const parts = sealed.split(".");
    parts[4] = Buffer.from("подмена").toString("base64url");
    assert.throws(() => openSecret(key, parts.join("."), ctx));
  });
});

describe("онлайн серверов", () => {
  it("проверяет адреса и токены", () => {
    assert.equal(onlineHost.safeParse("46.174.53.23").success, true);
    assert.equal(onlineHost.safeParse("rust.example.com").success, true);
    assert.equal(onlineHost.safeParse("http://evil/").success, false);
    assert.equal(discordTokenSchema.safeParse("abc").success, false);
    assert.equal(discordTokenSchema.safeParse(`${"A".repeat(24)}.${"b".repeat(6)}.${"c".repeat(27)}`).success, true);
  });

  it("распознаёт внутренние адреса", () => {
    for (const ip of ["127.0.0.1", "10.1.2.3", "172.20.0.5", "192.168.1.1", "169.254.1.1", "::1", "fd00::1", "::ffff:10.0.0.1"]) {
      assert.equal(isPrivateAddress(ip), true, ip);
    }
    for (const ip of ["46.174.53.23", "8.8.8.8", "2a00:1450::1"]) assert.equal(isPrivateAddress(ip), false, ip);
  });

  it("подставляет онлайн в текст статуса", () => {
    assert.equal(onlineStatusText("Онлайн: {players}/{max} ({queued})", { players: 50, max: 200, queued: 3 }), "Онлайн: 50/200 (3)");
  });
});
