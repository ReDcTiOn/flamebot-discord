import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";
import { describeLoginError, loadOrCreateBotKey, tokenContext } from "../src/credentials.js";
import { generateSecretKeyPair, openSecret, sealSecret } from "../src/secrets.js";

describe("ключ бота в томе", () => {
  const dir = mkdtempSync(join(tmpdir(), "flamebot-key-"));
  after(() => rmSync(dir, { recursive: true, force: true }));

  it("создаётся при первом запуске и читается при следующих", () => {
    const file = join(dir, "a", "secret.key");
    const first = loadOrCreateBotKey(file);
    assert.equal(first.source, "generated");
    const second = loadOrCreateBotKey(file);
    assert.equal(second.source, "file");
    assert.equal(second.publicKey, first.publicKey);
  });

  it("файл доступен только владельцу", { skip: process.platform === "win32" }, () => {
    const file = join(dir, "b", "secret.key");
    loadOrCreateBotKey(file);
    assert.equal(statSync(file).mode & 0o777, 0o600);
  });

  it("ключ из переменной окружения копируется в том и остаётся главным", () => {
    const file = join(dir, "c", "secret.key");
    const env = generateSecretKeyPair();
    const fromEnv = loadOrCreateBotKey(file, env.privateKey);
    assert.equal(fromEnv.source, "env");
    assert.equal(fromEnv.publicKey, env.publicKey);
    assert.equal(readFileSync(file, "utf8").trim(), env.privateKey);
    // Переменную убрали из .env — бот берёт тот же ключ из тома.
    assert.equal(loadOrCreateBotKey(file).publicKey, env.publicKey);
  });

  it("токен, зашифрованный для одного бота, не открывается как токен другого", () => {
    const key = loadOrCreateBotKey(join(dir, "d", "secret.key"));
    const sealed = sealSecret(key.publicKey, "token-value", tokenContext("rating"));
    assert.equal(openSecret(key.key, sealed, tokenContext("rating")), "token-value");
    assert.throws(() => openSecret(key.key, sealed, tokenContext("giveaway")));
  });
});

describe("ошибки входа в Discord", () => {
  it("понятно объясняет неверный токен и интенты", () => {
    assert.match(describeLoginError({ code: "TokenInvalid" }), /не принял токен/);
    assert.match(describeLoginError({ code: 4014, message: "Used disallowed intents" }), /интенты/);
    assert.match(describeLoginError(new Error("timeout")), /timeout/);
  });
});
