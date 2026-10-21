import { join } from "node:path";
import { botDataDir, ensureMapsDefaults, isBotEnabled, loadOrCreateBotKey, prisma, publishBotKey, reportBotState } from "@flamebot/core";
import type { Telegram } from "./clients/telegram.js";
import { processActions } from "./actions.js";
import { BOT_KEY, event, log } from "./events.js";
import { serial, service } from "./service.js";
import { ctx, loadContext } from "./state.js";
import { TelegramUi } from "./telegram.js";

// Процесс бота работает всегда, а сама работа включается и выключается из панели (BotControl).
// Выключенный бот не начинает генераций, не шлёт анонсы и не отвечает в Telegram.
const SUPERVISE_MS = 5_000;
const TICK_MS = 30_000;
const ACTIONS_MS = 2_000;
const HEARTBEAT_MS = 30_000;

// Ключ, которым панель шифрует секреты. Лежит в томе бота, в базу попадает только открытая часть.
const secretKey = loadOrCreateBotKey(join(botDataDir(), "secret.key"));
await publishBotKey(prisma, BOT_KEY, secretKey.publicKey);
if (secretKey.source === "generated") log.info("Создан ключ шифрования секретов в томе бота");
await ensureMapsDefaults(prisma);

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

async function start(): Promise<void> {
  running = true;
  await serial(() => service.resume());
  const { missing } = ctx();
  event("bot.start", missing.length ? `Бот карт запущен. Не настроено: ${missing.join(", ")}` : "Бот карт запущен", { level: missing.length ? "WARN" : "INFO" });
}

let lastState: "running" | "paused" | null = null;
let lastBeat = 0;

async function supervise(): Promise<void> {
  await loadContext(secretKey);
  const enabled = await isBotEnabled(prisma, BOT_KEY);
  if (enabled && !running) {
    if (lastState === "paused") event("bot.resumed", "Бот карт запущен из панели");
    await start();
  } else if (!enabled && running) {
    running = false;
    log.info("Остановка по команде из панели");
    event("bot.paused", "Бот карт остановлен из панели: генерации не запускаются, анонсы не уходят", { level: "WARN" });
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

await supervise().catch((err) => log.error("Ошибка запуска бота карт", err));
every("проверка панели", supervise, SUPERVISE_MS);
every("расписание вайпов", async () => {
  if (!running) return;
  await serial(() => service.tick());
  await serial(() => service.reconcileIfDue());
}, TICK_MS);
every("задания из панели", async () => {
  if (running) await processActions();
}, ACTIONS_MS);
