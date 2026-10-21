// Переносит данные прежнего бота объявлений на Python (msg_wipe_bot).
//   pnpm -F notice-bot import-old <папка прежнего бота>
// Из папки берутся:
//   data/templates.json — тексты, тексты по умолчанию для правил, настройки промокода, картинки;
//   data/agenda.json    — план дня и напоминания;
//   data/wipebot.sqlite3 — история вайпов и отметки плана дня (ключи событий те же, поэтому
//                          уже отправленные вайпы не повторятся);
//   .env (если есть)    — админы, ВКонтакте, gamestores, тайминги и секреты. Секреты шифруются ключом
//                          бота объявлений, поэтому бот должен хотя бы раз запуститься до импорта.
// Тексты, план и история переносятся один раз, в пустые таблицы. Повторный запуск переносит только .env.
// Значения секретов не печатаются.
import { existsSync, readFileSync } from "node:fs";
import { extname, join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import {
  NOTICE_BOT_KEY,
  ensureNoticeDefaults,
  noticeSecretContext,
  noticeSecretHint,
  noticeSecretProblem,
  noticeTemplateSchema,
  parseVkPhoto,
  prisma,
  sealSecret,
  type NoticeSecretName,
  type Prisma,
} from "@flamebot/core";

const dir = process.argv[2] ? resolve(process.argv[2]) : "";
const tplPath = join(dir, "data", "templates.json");
if (!dir || !existsSync(tplPath)) {
  console.error("Использование: pnpm -F notice-bot import-old /путь/к/папке/msg_wipe_bot");
  console.error("В папке должен быть data/templates.json (и, по возможности, data/wipebot.sqlite3, data/agenda.json, .env).");
  process.exit(1);
}

const dataDone = (await prisma.noticeTemplate.count()) > 0 || (await prisma.noticeEvent.count()) > 0;
if (dataDone) console.log("Тексты и история уже перенесены, поэтому переношу только настройки и секреты из .env.");
await ensureNoticeDefaults(prisma);

type Row = Record<string, unknown>;
const readJson = (path: string) => JSON.parse(readFileSync(path, "utf8")) as Row;
const MIME: Record<string, string> = { ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp", ".gif": "image/gif" };
const WEEKDAYS: Record<string, number> = {
  понедельник: 0, вторник: 1, среда: 2, четверг: 3, пятница: 4, суббота: 5, воскресенье: 6,
  monday: 0, tuesday: 1, wednesday: 2, thursday: 3, friday: 4, saturday: 5, sunday: 6,
};

async function importData(): Promise<void> {
  // ------------------------------------------------------------------ тексты и картинки
  const raw = readJson(tplPath);
  const templates = ((raw.templates ?? []) as Row[]).map((t, i) =>
    noticeTemplateSchema.parse({
      id: t.id,
      title: t.title || t.id,
      kind: t.kind,
      discord: t.discord,
      vk: t.vk,
      promoAmount: (t.promo as Row | undefined)?.amount ?? null,
      sortOrder: i,
    }),
  );
  await prisma.noticeTemplate.createMany({ data: templates.map((t) => ({ ...t, discord: t.discord as Prisma.InputJsonValue })) });

  const defaults = (raw.defaults ?? {}) as Record<string, Record<string, string>>;
  for (const key of ["tuesday", "thursday", "friday"]) {
    const d = defaults[key];
    if (d) await prisma.noticeRule.update({ where: { key }, data: { regularTemplateId: d.regular ?? null, globalTemplateId: d.global ?? null } });
  }

  const promo = raw.promo as Row | undefined;
  if (promo) {
    await prisma.noticeSettings.update({
      where: { id: 1 },
      data: { promoCode: String(promo.code), promoType: String(promo.type), promoDaysAfter: Number(promo.days_after), promoEndTime: String(promo.end_time) },
    });
  }

  const images: string[] = [];
  for (const [kind, rel] of Object.entries((raw.images ?? {}) as Record<string, string>)) {
    const path = resolve(join(dir, "data"), rel);
    const mime = MIME[extname(path).toLowerCase()];
    if (!existsSync(path) || !mime || (kind !== "regular" && kind !== "global")) {
      console.log(`Картинка ${kind} не перенесена: файла ${path} нет или формат не поддерживается`);
      continue;
    }
    const data = readFileSync(path);
    await prisma.noticeImage.upsert({
      where: { kind },
      create: { kind, data, mime, size: data.length, updatedByName: "перенесена из прежнего бота" },
      update: { data, mime, size: data.length, updatedByName: "перенесена из прежнего бота" },
    });
    images.push(`${kind} (${Math.round(data.length / 1024)} КБ)`);
  }
  console.log(`Тексты: ${templates.length}. Картинки: ${images.join(", ") || "нет"}.`);

  // ------------------------------------------------------------------ план дня
  const agendaPath = join(dir, "data", "agenda.json");
  if (existsSync(agendaPath)) {
    const a = readJson(agendaPath);
    await prisma.noticeSettings.update({
      where: { id: 1 },
      data: {
        ...(a.send_at ? { agendaSendAt: String(a.send_at) } : {}),
        ...(a.grace_minutes !== undefined ? { agendaGraceMinutes: Math.round(Number(a.grace_minutes)) } : {}),
        ...(a.greeting ? { agendaGreeting: String(a.greeting) } : {}),
      },
    });
    let days = 0;
    for (const [name, items] of Object.entries((a.days ?? {}) as Record<string, string[]>)) {
      const weekday = WEEKDAYS[name.toLowerCase()];
      if (weekday === undefined) continue;
      await prisma.noticeAgendaDay.upsert({ where: { weekday }, create: { weekday, items }, update: { items } });
      days++;
    }
    const reminders = (a.reminders ?? []) as Row[];
    for (const [i, r] of reminders.entries()) {
      await prisma.noticeReminder.create({
        data: {
          id: String(r.id),
          title: String(r.title),
          text: String(r.text),
          button: String(r.button ?? "✅ Готово"),
          doneText: String(r.done_text ?? "Больше сегодня не напомню."),
          days: ((r.days ?? []) as string[]).map((d) => WEEKDAYS[d.toLowerCase()]).filter((d): d is number => d !== undefined),
          times: ((r.times ?? []) as string[]).map((t) => t.padStart(5, "0")).sort(),
          graceMinutes: Math.round(Number(r.grace_minutes ?? 60)),
          sortOrder: i,
        },
      });
    }
    console.log(`План дня: дней ${days}, напоминаний ${reminders.length}.`);
  }

  // ------------------------------------------------------------------ история
  const dbPath = join(dir, "data", "wipebot.sqlite3");
  if (existsSync(dbPath)) {
    const db = new DatabaseSync(dbPath, { readOnly: true });
    const json = (v: unknown, fallback: unknown) => (v ? JSON.parse(String(v)) : fallback);
    // Результат промокода у прежнего бота: {state, detail, code, amount, date_end}.
    const results = (r: Row) => {
      const out = { ...r };
      const p = r.promo as Row | undefined;
      if (p) out.promo = { state: p.state, text: p.detail ?? "", code: p.code ?? undefined, amount: p.amount ?? undefined, dateEnd: p.date_end ?? undefined };
      return out;
    };
    const events = (db.prepare("SELECT * FROM events WHERE is_test = 0 ORDER BY when_ts").all() as Row[]).map((e) => ({
      key: String(e.key),
      wipeAt: new Date(Number(e.when_ts) * 1000),
      kind: String(e.kind),
      templateId: String(e.template_id),
      status: String(e.status),
      confirmed: Number(e.confirmed) !== 0,
      notified: Number(e.notified) !== 0,
      reminded: Number(e.reminded) !== 0,
      results: results(json(e.results, {})) as Prisma.InputJsonValue,
      msgs: json(e.msgs, []) as Prisma.InputJsonValue,
      promo: (json(e.promo, null) ?? undefined) as Prisma.InputJsonValue | undefined,
    }));
    await prisma.noticeEvent.createMany({ data: events, skipDuplicates: true });

    let marks = 0;
    for (const r of db.prepare("SELECT key, data FROM daily_log").all() as Row[]) {
      const key = String(r.key);
      const data = JSON.parse(String(r.data)) as Row;
      if (key === "agenda:enabled") {
        await prisma.noticeSettings.update({ where: { id: 1 }, data: { agendaEnabled: data.enabled !== false } });
        continue;
      }
      await prisma.noticeDaily.upsert({ where: { key }, create: { key, data: data as Prisma.InputJsonValue }, update: {} });
      marks++;
    }
    const pending = events.filter((e) => e.status === "pending").length;
    console.log(`История: вайпов ${events.length} (ждут отправки: ${pending}), отметок плана дня ${marks}.`);
  }
}
if (!dataDone) await importData();

// ------------------------------------------------------------------ .env
const envPath = join(dir, ".env");
if (existsSync(envPath)) {
  const env: Record<string, string> = {};
  for (const line of readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line);
    if (m && !line.trimStart().startsWith("#")) env[m[1]!] = m[2]!.replace(/^(['"])(.*)\1$/, "$2");
  }
  const v = (k: string) => env[k]?.trim() || null;
  const group = (k: string) => (v(k) && /^-?\d+$/.test(v(k)!) ? Math.abs(Number(v(k))) : undefined);
  const photo = (k: string) => (v(k) ? (parseVkPhoto(v(k)!) ?? undefined) : undefined);
  const truthy = (k: string) => ["1", "true", "yes"].includes((v(k) ?? "").toLowerCase());

  const s: Prisma.NoticeSettingsUpdateInput = {};
  const admins = (v("ADMIN_IDS") ?? "").split(/[,;\s]+/).filter((x) => /^\d+$/.test(x));
  if (admins.length) s.telegramAdminIds = admins;
  if (group("VK_GROUP_ID")) s.vkGroupId = group("VK_GROUP_ID");
  if (photo("VK_PHOTO_REGULAR")) s.vkPhotoRegular = photo("VK_PHOTO_REGULAR");
  if (photo("VK_PHOTO_GLOBAL")) s.vkPhotoGlobal = photo("VK_PHOTO_GLOBAL");
  if (group("TEST_VK_GROUP_ID")) s.testVkGroupId = group("TEST_VK_GROUP_ID");
  if (photo("TEST_VK_PHOTO_REGULAR")) s.testVkPhotoRegular = photo("TEST_VK_PHOTO_REGULAR");
  if (photo("TEST_VK_PHOTO_GLOBAL")) s.testVkPhotoGlobal = photo("TEST_VK_PHOTO_GLOBAL");
  if (v("GAMESTORES_STORE_ID")) s.gamestoresStoreId = v("GAMESTORES_STORE_ID");
  if (v("GAMESTORES_LIMIT_USES")) s.promoLimitUses = Number(v("GAMESTORES_LIMIT_USES"));
  if (env.GAMESTORES_TEST_REAL !== undefined) s.promoTestReal = truthy("GAMESTORES_TEST_REAL");
  if (env.DRY_RUN !== undefined) s.dryRun = truthy("DRY_RUN");
  if (v("NOTIFY_HOURS_BEFORE")) s.notifyMinutes = Math.round(Number(v("NOTIFY_HOURS_BEFORE")) * 60);
  if (v("REMIND_MINUTES_BEFORE")) s.remindMinutes = Math.round(Number(v("REMIND_MINUTES_BEFORE")));
  if (v("MAX_LATE_MINUTES")) s.maxLateMinutes = Math.round(Number(v("MAX_LATE_MINUTES")));
  await prisma.noticeSettings.update({ where: { id: 1 }, data: s });
  console.log(`Настройки из .env: ${Object.keys(s).join(", ") || "нечего переносить"}.`);

  const SECRETS: [NoticeSecretName, string][] = [
    ["telegramToken", "BOT_TOKEN"],
    ["discordWebhook", "DISCORD_WEBHOOK_URL"],
    ["vkToken", "VK_TOKEN"],
    ["gamestoresSecretKey", "GAMESTORES_SECRET_KEY"],
    ["testDiscordWebhook", "TEST_DISCORD_WEBHOOK_URL"],
    ["testVkToken", "TEST_VK_TOKEN"],
  ];
  const key = await prisma.botPublicKey.findUnique({ where: { botKey: NOTICE_BOT_KEY } });
  if (!key) {
    console.log("Секреты не перенесены: бот объявлений ещё ни разу не запускался, ключа шифрования нет. Запусти его и повтори импорт (перенесётся только .env) или введи секреты в панели («Подключение»).");
  } else {
    const done: string[] = [];
    for (const [name, envKey] of SECRETS) {
      const value = v(envKey);
      if (!value) continue;
      const problem = noticeSecretProblem(name, value);
      if (problem) {
        console.log(`Пропущен ${envKey}: ${problem}`);
        continue;
      }
      const data = {
        valueEnc: sealSecret(key.publicKey, value, noticeSecretContext(name)),
        hint: noticeSecretHint(name, value),
        setAt: new Date(),
        setById: null,
        setByName: "перенесён из .env",
      };
      await prisma.noticeSecret.upsert({ where: { name }, create: { name, ...data }, update: data });
      done.push(envKey);
    }
    console.log(`Секреты зашифрованы и сохранены: ${done.join(", ") || "в .env их нет"}.`);
  }
}
await prisma.$disconnect();
