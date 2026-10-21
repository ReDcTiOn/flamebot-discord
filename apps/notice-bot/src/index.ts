import { join } from "node:path";
import { botDataDir, ensureNoticeDefaults, isBotEnabled, loadOrCreateBotKey, prisma, publishBotKey, reportBotState } from "@flamebot/core";
import type { Telegram } from "@flamebot/core/telegram";
import { processActions } from "./actions.js";
import { agendaTick } from "./agenda.js";
import { BOT_KEY, event, log } from "./events.js";
import { serial, service } from "./service.js";
import { ctx, loadContext } from "./state.js";
import { TelegramUi } from "./telegram.js";

// Процесс бота работает всегда, а сама работа включается и выключается из панели (BotControl).
// Выключенный бот не присылает уведомлений, не публикует объявления и не отвечает в Telegram.
const SUPERVISE_MS = 5_000;
const TICK_MS = 20_000;
const ACTIONS_MS = 2_000;
const HEARTBEAT_MS = 30_000;

// Ключ, которым панель шифрует секреты. Лежит в томе бота, в базу попадает только открытая часть.
const secretKey = loadOrCreateBotKey(join(botDataDir(), "secret.key"));
await publishBotKey(prisma, BOT_KEY, secretKey.publicKey);
if (secretKey.source === "generated") log.info("Создан ключ шифрования секретов в томе бота");
await ensureNoticeDefaults(prisma);

let running = false;
let ui: TelegramUi | null = null;
let uiFor: Telegram | null = null;

// Telegram подключается и переподключается сам, когда в панели меняют токен или админов.
async function syncTelegram(): Promise<void> {
  const t = running ? ctx().telegram : null;
  if (t === uiFor) return;
  ui?.stop();
  ui = null;
  uiFor = t;
  if (!t) return;
  ui = new TelegramUi(t);
  try {
    const me = await t.getMe();
    log.info(`Telegram: бот @${me.username ?? me.id}`);
    await ui.setupMenu();
  } catch (err) {
    log.warn("Telegram не ответил при подключении", err);
  }
  void ui.run();
}

let startedOnce = false;

async function start(): Promise<void> {
  running = true;
  // Сообщение «бот запущен» — только при запуске процесса, а не после каждой паузы из панели.
  if (!startedOnce) {
    startedOnce = true;
    await serial(() => service.startup()).catch((err) => log.error("Ошибка при запуске", err));
  }
  const { missing } = ctx();
  event("bot.start", missing.length ? `Бот объявлений запущен. Не настроено: ${missing.join(", ")}` : "Бот объявлений запущен", { level: missing.length ? "WARN" : "INFO" });
}

let lastState: "running" | "paused" | null = null;
let lastBeat = 0;

async function supervise(): Promise<void> {
  await loadContext(secretKey);
  const enabled = await isBotEnabled(prisma, BOT_KEY);
  if (enabled && !running) {
    if (lastState === "paused") event("bot.resumed", "Бот объявлений запущен из панели");
    await start();
  } else if (!enabled && running) {
    running = false;
    log.info("Остановка по команде из панели");
    event("bot.paused", "Бот объявлений остановлен из панели: уведомления и объявления не уходят", { level: "WARN" });
  }
  await syncTelegram();

  const state = running ? "running" : "paused";
  if (state !== lastState || Date.now() - lastBeat > HEARTBEAT_MS) {
    await reportBotState(prisma, BOT_KEY, state);
    lastState = state;
    lastBeat = Date.now();
  }
}

// Периодическая задача: следующий запуск не начнётся, пока не закончился предыдущий.
function every(name: string, fn: () => Promise<void>, ms: number): void {
  let busy = false;
  setInterval(() => {
    if (busy) return;
    busy = true;
    fn()
      .catch((err) => log.error(`Ошибка фоновой задачи «${name}»`, err))
      .finally(() => {
        busy = false;
      });
  }, ms);
}

process.on("unhandledRejection", (err) => log.error("Необработанная ошибка", err));

async function shutdown(signal: string) {
  log.info(`Получен ${signal}, останавливаемся`);
  ui?.stop();
  await prisma.$disconnect();
  process.exit(0);
}
process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));

await supervise().catch((err) => log.error("Ошибка запуска бота объявлений", err));
every("проверка панели", supervise, SUPERVISE_MS);
every("расписание вайпов", async () => {
  if (!running) return;
  await serial(() => service.tick());
  // План дня — отдельно: его сбой не должен мешать вайпам.
  await serial(() => agendaTick(new Date())).catch((err) => log.error("Ошибка в плане дня или напоминаниях", err));
}, TICK_MS);
every("задания из панели", async () => {
  if (running) await processActions();
}, ACTIONS_MS);
