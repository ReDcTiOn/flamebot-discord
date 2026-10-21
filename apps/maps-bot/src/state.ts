import {
  MAPS_SECRET_NAMES,
  getMapsSettings,
  mapsSecretContext,
  openSecret,
  prisma,
  resolveScoring,
  type BotKey,
  type MapsScoring,
  type MapsSecretName,
  type MapsServer,
  type MapsSettings,
  type MapsWipeRule,
} from "@flamebot/core";
import { PterodactylClient } from "./clients/ptero.js";
import { RustMapsClient } from "./clients/rustmaps.js";
import { S3Storage } from "./clients/s3.js";
import { Telegram } from "./clients/telegram.js";
import { log } from "./events.js";

// Всё, что бот берёт из панели: настройки, серверы, правила и готовые клиенты внешних сервисов.
// Пересобирается, когда в панели что-то меняют, — без перезапуска бота.
export interface MapsContext {
  settings: MapsSettings;
  servers: Map<number, MapsServer>;
  rules: MapsWipeRule[];
  scoring: MapsScoring;
  rustmaps: RustMapsClient | null;
  storage: S3Storage | null;
  ptero: PterodactylClient | null;
  telegram: Telegram | null;
  webhook: string | null;
  // Куда слать сообщения и кто может нажимать кнопки.
  chatId: string | null;
  adminIds: Set<string>;
  // Чего не хватает для работы: показывается в панели и в /status.
  missing: string[];
  signature: string;
}

let current: MapsContext | null = null;
let secretsCache: { version: string; values: Partial<Record<MapsSecretName, string>>; broken: string[] } | null = null;

async function loadSecrets(key: BotKey) {
  const rows = await prisma.mapsSecret.findMany();
  const version = rows.map((r) => `${r.name}:${r.setAt.getTime()}`).sort().join("|");
  if (secretsCache?.version === version) return secretsCache;
  const values: Partial<Record<MapsSecretName, string>> = {};
  const broken: string[] = [];
  for (const row of rows) {
    if (!(MAPS_SECRET_NAMES as string[]).includes(row.name)) continue;
    const name = row.name as MapsSecretName;
    try {
      values[name] = openSecret(key.key, row.valueEnc, mapsSecretContext(name));
    } catch {
      broken.push(name);
    }
  }
  if (broken.length) log.warn(`Не расшифровываются секреты: ${broken.join(", ")}. Их нужно ввести в панели заново.`);
  secretsCache = { version, values, broken };
  return secretsCache;
}

export async function loadContext(key: BotKey): Promise<MapsContext> {
  const [settings, servers, rules, secrets] = await Promise.all([
    getMapsSettings(prisma),
    prisma.mapsServer.findMany({ orderBy: { id: "asc" } }),
    prisma.mapsWipeRule.findMany({ orderBy: { key: "asc" } }),
    loadSecrets(key),
  ]);
  const signature = JSON.stringify([
    settings.updatedAt.getTime(),
    servers.map((s) => s.updatedAt.getTime()),
    rules.map((r) => r.updatedAt.getTime()),
    secrets.version,
  ]);
  if (current?.signature === signature) return current;

  const s = secrets.values;
  const missing: string[] = [];
  if (!s.rustmapsApiKey) missing.push("API-ключ RustMaps");
  const s3Ready = !!(s.s3AccessKey && s.s3SecretKey && settings.s3Endpoint && settings.s3Bucket && settings.cdnBaseUrl);
  if (!s3Ready) missing.push("доступ к S3 (ключи, адрес, бакет и адрес CDN)");
  if (!s.discordWebhook) missing.push("вебхук Discord");
  const adminIds = new Set(settings.telegramAdminIds);
  if (s.telegramToken && adminIds.size === 0 && !settings.telegramChatId) missing.push("Telegram ID админов");

  current = {
    settings,
    servers: new Map(servers.map((sv) => [sv.id, sv])),
    rules,
    scoring: resolveScoring(settings.scoring),
    rustmaps: s.rustmapsApiKey ? new RustMapsClient(s.rustmapsApiKey, settings.rustmapsOrgId) : null,
    storage: s3Ready
      ? new S3Storage({
          endpoint: settings.s3Endpoint,
          region: settings.s3Region || "us-east-1",
          bucket: settings.s3Bucket,
          accessKey: s.s3AccessKey!,
          secretKey: s.s3SecretKey!,
          prefix: settings.s3Prefix,
          addressing: settings.s3Addressing === "virtual" ? "virtual" : "path",
          cdnBaseUrl: settings.cdnBaseUrl,
        })
      : null,
    ptero: settings.pteroUrl && s.pteroApiKey ? new PterodactylClient(settings.pteroUrl, s.pteroApiKey) : null,
    telegram: s.telegramToken ? new Telegram(s.telegramToken) : null,
    webhook: s.discordWebhook ?? null,
    chatId: settings.telegramChatId || settings.telegramAdminIds[0] || null,
    adminIds,
    missing,
    signature,
  };
  return current;
}

export function ctx(): MapsContext {
  if (!current) throw new Error("Настройки бота ещё не загружены");
  return current;
}

export const serverTitle = (id: number) => ctx().servers.get(id)?.title ?? `FR #${id}`;
