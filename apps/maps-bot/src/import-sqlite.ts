// Переносит данные прежнего бота карт на Python.
//   pnpm -F maps-bot import-sqlite <путь к bot.sqlite3> [--env <путь к .env прежнего бота>]
// Из базы — вайпы, карты серверов, пул карт и признак автоподбора; номера сохраняются, поэтому
// старые карточки в Telegram продолжат работать, если оставить тот же токен.
// Из .env (необязательно) — настройки и секреты. Секреты шифруются ключом бота карт,
// поэтому бот должен хотя бы раз запуститься до импорта. Значения секретов не печатаются.
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import {
  MAPS_BOT_KEY,
  ensureMapsDefaults,
  mapsSecretContext,
  mapsSecretHint,
  mapsSecretProblem,
  prisma,
  sealSecret,
  type MapsSecretName,
  type Prisma,
} from "@flamebot/core";

const args = process.argv.slice(2);
const envIdx = args.indexOf("--env");
const envPath = envIdx >= 0 ? args[envIdx + 1] : undefined;
const dbPath = args.find((a, i) => !a.startsWith("--") && i !== envIdx + 1);

if (!dbPath || !existsSync(dbPath) || (envPath !== undefined && !existsSync(envPath))) {
  console.error("Использование: pnpm -F maps-bot import-sqlite /путь/к/bot.sqlite3 [--env /путь/к/.env]");
  process.exit(1);
}

// ------------------------------------------------------------------ база
const db = new DatabaseSync(resolve(dbPath), { readOnly: true });
type Row = Record<string, unknown>;
const rows = (sql: string) => db.prepare(sql).all() as Row[];
const tableCols = (t: string) => new Set((db.prepare(`PRAGMA table_info(${t})`).all() as { name: string }[]).map((c) => c.name));
const col = (r: Row, name: string, fallback: unknown = null) => (name in r ? r[name] : fallback);
const date = (v: unknown) => (v ? new Date(String(v)) : null);
const int = (v: unknown) => (v === null || v === undefined ? null : Number(v));
const bool = (v: unknown) => Number(v ?? 0) !== 0;
const json = (v: unknown): Prisma.InputJsonValue | undefined => (v ? (JSON.parse(String(v)) as Prisma.InputJsonValue) : undefined);

if ((await prisma.mapsCycle.count()) > 0) {
  console.error("В новой базе уже есть вайпы. Импорт делается один раз в пустые таблицы, поэтому остановлен.");
  process.exit(1);
}

const cycles = rows("SELECT * FROM cycles ORDER BY wipe_at");
const slots = rows("SELECT * FROM maps ORDER BY id");
const cands = tableCols("candidates").size ? rows("SELECT * FROM candidates ORDER BY id") : [];
const autoPick = tableCols("settings").size ? rows("SELECT value FROM settings WHERE key = 'auto_pick'")[0]?.value === "1" : false;

await ensureMapsDefaults(prisma);
await prisma.$transaction(
  async (tx) => {
    await tx.mapsCycle.createMany({
      data: cycles.map((c) => ({
        id: String(c.id),
        ruleKey: String(c.rule_key),
        wipeAt: date(c.wipe_at)!,
        sendAt: date(c.send_at)!,
        status: String(c.status),
        promptMsgId: int(c.prompt_msg_id),
        createdAt: date(c.created_at) ?? new Date(),
        staging: bool(col(c, "staging")),
        warned: bool(col(c, "warned")),
        blueprints: bool(col(c, "blueprints")),
        autoMode: bool(col(c, "auto_mode")),
        autoMsgId: int(col(c, "auto_msg_id")),
        panelState: String(col(c, "panel_state", "idle")),
        panelMsgId: int(col(c, "panel_msg_id")),
        panelNotifiedAt: date(col(c, "panel_notified_at")),
      })),
    });
    for (const m of slots) {
      // Слоты из самых ранних версий (queued/generating) ждут карту из пула.
      const status = ["queued", "generating"].includes(String(m.status)) ? "waiting" : String(m.status);
      await tx.mapsSlot.create({
        data: {
          id: Number(m.id),
          cycleId: String(m.cycle_id),
          serverId: Number(m.server_id),
          size: Number(m.size),
          config: String(m.config),
          attempt: Number(m.attempt ?? 1),
          seed: int(m.seed),
          rmMapId: (m.rm_map_id as string | null) ?? null,
          status,
          info: json(m.info_json),
          viewUrl: (m.view_url as string | null) ?? null,
          s3Key: (m.s3_key as string | null) ?? null,
          cdnUrl: (m.cdn_url as string | null) ?? null,
          error: (m.error as string | null) ?? null,
          tgMsgId: int(m.tg_msg_id),
          source: String(col(m, "source", "rustmaps")),
          candId: int(col(m, "cand_id")),
          tgPhotoMsgId: int(col(m, "tg_photo_msg_id")),
          panelSynced: bool(col(m, "panel_synced")),
          panelNote: (col(m, "panel_note") as string | null) ?? null,
        },
      });
    }
    for (const c of cands) {
      await tx.mapsCandidate.create({
        data: {
          id: Number(c.id),
          cycleId: String(c.cycle_id),
          size: Number(c.size),
          config: String(c.config),
          seed: int(c.seed),
          rmMapId: (c.rm_map_id as string | null) ?? null,
          status: String(c.status),
          info: json(c.info_json),
          viewUrl: (c.view_url as string | null) ?? null,
          error: (c.error as string | null) ?? null,
          slotId: int(col(c, "slot_id")),
          rejectedOrder: int(col(c, "rejected_order")),
          parkedOrder: int(col(c, "parked_order")),
        },
      });
    }
    // Номера заданы вручную, поэтому счётчики продолжаем с наибольшего номера.
    await tx.$executeRawUnsafe(`SELECT setval(pg_get_serial_sequence('"MapsSlot"', 'id'), GREATEST((SELECT MAX(id) FROM "MapsSlot"), 1))`);
    await tx.$executeRawUnsafe(`SELECT setval(pg_get_serial_sequence('"MapsCandidate"', 'id'), GREATEST((SELECT MAX(id) FROM "MapsCandidate"), 1))`);
    await tx.mapsSettings.update({ where: { id: 1 }, data: { autoPick } });
  },
  { timeout: 120_000 },
);
console.log(`Перенесено: вайпов ${cycles.length}, карт серверов ${slots.length}, карт в пуле ${cands.length}. Автоподбор: ${autoPick ? "включён" : "выключен"}.`);

// ------------------------------------------------------------------ .env
if (envPath) {
  const env: Record<string, string> = {};
  for (const line of readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line);
    if (m && !line.trimStart().startsWith("#")) env[m[1]!] = m[2]!.replace(/^(['"])(.*)\1$/, "$2");
  }
  const v = (k: string) => env[k]?.trim() || null;

  const settings: Prisma.MapsSettingsUpdateInput = {};
  const admins = v("TELEGRAM_ADMIN_IDS");
  if (admins) settings.telegramAdminIds = admins.replace(/\s/g, "").split(",").filter((x) => /^\d+$/.test(x));
  if (v("TELEGRAM_CHAT_ID")) settings.telegramChatId = v("TELEGRAM_CHAT_ID");
  if (v("RUSTMAPS_ORG_ID")) settings.rustmapsOrgId = v("RUSTMAPS_ORG_ID");
  if (v("S3_ENDPOINT")) settings.s3Endpoint = v("S3_ENDPOINT")!.replace(/\/+$/, "");
  if (v("S3_REGION")) settings.s3Region = v("S3_REGION")!;
  if (v("S3_BUCKET")) settings.s3Bucket = v("S3_BUCKET")!;
  if (env.S3_PREFIX !== undefined) settings.s3Prefix = (v("S3_PREFIX") ?? "").replace(/^\/+|\/+$/g, "");
  if (v("S3_ADDRESSING")) settings.s3Addressing = v("S3_ADDRESSING")!.toLowerCase() === "virtual" ? "virtual" : "path";
  if (v("CDN_BASE_URL")) settings.cdnBaseUrl = v("CDN_BASE_URL")!.replace(/\/+$/, "");
  if (v("PTERO_URL")) settings.pteroUrl = v("PTERO_URL")!.replace(/\/+$/, "");
  if (v("SEND_LEAD_HOURS")) settings.sendLeadHours = Number(v("SEND_LEAD_HOURS"));
  if (v("GEN_LEAD_HOURS")) settings.genLeadHours = Number(v("GEN_LEAD_HOURS"));
  await prisma.mapsSettings.update({ where: { id: 1 }, data: settings });
  console.log(`Настройки из .env: ${Object.keys(settings).join(", ") || "нечего переносить"}.`);

  for (const server of await prisma.mapsServer.findMany()) {
    const uuid = v(`PTERO_UUID_${server.id}`);
    if (uuid) await prisma.mapsServer.update({ where: { id: server.id }, data: { pteroUuid: uuid } });
  }

  const SECRETS: [MapsSecretName, string][] = [
    ["telegramToken", "TELEGRAM_BOT_TOKEN"],
    ["rustmapsApiKey", "RUSTMAPS_API_KEY"],
    ["s3AccessKey", "S3_ACCESS_KEY"],
    ["s3SecretKey", "S3_SECRET_KEY"],
    ["discordWebhook", "DISCORD_WEBHOOK_URL"],
    ["pteroApiKey", "PTERO_API_KEY"],
  ];
  const key = await prisma.botPublicKey.findUnique({ where: { botKey: MAPS_BOT_KEY } });
  if (!key) {
    console.log("Секреты не перенесены: бот карт ещё ни разу не запускался, ключа шифрования нет. Запусти его и повтори с --env или введи секреты в панели.");
  } else {
    const done: string[] = [];
    for (const [name, envKey] of SECRETS) {
      const value = v(envKey);
      if (!value) continue;
      const problem = mapsSecretProblem(name, value);
      if (problem) {
        console.log(`Пропущен ${envKey}: ${problem}`);
        continue;
      }
      const data = {
        valueEnc: sealSecret(key.publicKey, value, mapsSecretContext(name)),
        hint: mapsSecretHint(name, value),
        setAt: new Date(),
        setById: null,
        setByName: "перенесён из .env",
      };
      await prisma.mapsSecret.upsert({ where: { name }, create: { name, ...data }, update: data });
      done.push(envKey);
    }
    console.log(`Секреты зашифрованы и сохранены: ${done.join(", ") || "в .env их нет"}.`);
  }
}
await prisma.$disconnect();
