import {
  createCipheriv,
  createDecipheriv,
  createPrivateKey,
  createPublicKey,
  diffieHellman,
  generateKeyPairSync,
  hkdfSync,
  randomBytes,
  type KeyObject,
} from "node:crypto";

// Секреты ботов (токены Discord, пароли RCON) шифруются открытым ключом бота.
// Панель умеет только зашифровать: приватного ключа у неё нет, поэтому прочитать
// сохранённый секрет не может ни панель, ни тот, кто украдёт базу.
// Схема: X25519 (одноразовый ключ отправителя) + HKDF-SHA256 + AES-256-GCM.
// context (например "online:5:discordToken") входит в AAD: шифротекст нельзя
// переставить в другое поле или другому серверу.

const VERSION = "s1";
const INFO = Buffer.from("flamebot-sealed-secret-v1");

const b64 = (b: Buffer) => b.toString("base64url");
const unb64 = (s: string) => Buffer.from(s, "base64url");

function rawPublic(key: KeyObject): Buffer {
  return Buffer.from(key.export({ format: "jwk" }).x as string, "base64url");
}

export function generateSecretKeyPair(): { privateKey: string; publicKey: string } {
  const { privateKey, publicKey } = generateKeyPairSync("x25519");
  return {
    privateKey: b64(privateKey.export({ format: "der", type: "pkcs8" })),
    publicKey: b64(rawPublic(publicKey)),
  };
}

export function loadPrivateKey(base64: string): { key: KeyObject; publicKey: string } {
  const key = createPrivateKey({ key: unb64(base64.trim()), format: "der", type: "pkcs8" });
  if (key.asymmetricKeyType !== "x25519") throw new Error("Ключ должен быть X25519");
  return { key, publicKey: b64(rawPublic(createPublicKey(key))) };
}

function publicFromRaw(raw: string): KeyObject {
  const bytes = unb64(raw);
  if (bytes.length !== 32) throw new Error("Неверный открытый ключ");
  return createPublicKey({ key: { kty: "OKP", crv: "X25519", x: b64(bytes) }, format: "jwk" });
}

function deriveKey(shared: Buffer, ephemeral: Buffer, recipient: Buffer): Buffer {
  return Buffer.from(hkdfSync("sha256", shared, Buffer.concat([ephemeral, recipient]), INFO, 32));
}

export function sealSecret(recipientPublicKey: string, plaintext: string, context: string): string {
  const recipient = publicFromRaw(recipientPublicKey);
  const eph = generateKeyPairSync("x25519");
  const ephRaw = rawPublic(eph.publicKey);
  const key = deriveKey(diffieHellman({ privateKey: eph.privateKey, publicKey: recipient }), ephRaw, rawPublic(recipient));
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(Buffer.from(context));
  const data = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return [VERSION, b64(ephRaw), b64(iv), b64(cipher.getAuthTag()), b64(data)].join(".");
}

export function openSecret(privateKey: KeyObject, sealed: string, context: string): string {
  const [version, eph, iv, tag, data] = sealed.split(".");
  if (version !== VERSION || !eph || !iv || !tag || data === undefined) throw new Error("Неизвестный формат секрета");
  const ephKey = publicFromRaw(eph);
  const key = deriveKey(diffieHellman({ privateKey, publicKey: ephKey }), unb64(eph), rawPublic(createPublicKey(privateKey)));
  const decipher = createDecipheriv("aes-256-gcm", key, unb64(iv));
  decipher.setAAD(Buffer.from(context));
  decipher.setAuthTag(unb64(tag));
  return Buffer.concat([decipher.update(unb64(data)), decipher.final()]).toString("utf8");
}

export const secretContext = (module: string, id: number, field: string) => `${module}:${id}:${field}`;
