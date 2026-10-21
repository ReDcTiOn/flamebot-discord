import { join } from "node:path";
import { Client, Events, GatewayIntentBits, Routes, type Guild } from "discord.js";
import {
  botDataDir,
  botTokenVersion,
  describeLoginError,
  isBotEnabled,
  loadBotToken,
  loadOrCreateBotKey,
  prisma,
  publishBotKey,
  reportBotIdentity,
  reportBotState,
} from "@flamebot/core";
import { buildCommands } from "./commands.js";
import { config } from "./config.js";
import { BOT_KEY, event, log } from "./events.js";
import { tick } from "./giveaways.js";
import { handleInteraction } from "./handlers.js";
import { getSettings } from "./util.js";

// Процесс бота работает всегда, а подключение к Discord включается и выключается из панели
// (таблица BotControl). Выключенный бот выходит из Discord и ждёт команды на запуск.
const CONTROL_POLL_MS = 5_000;
const HEARTBEAT_MS = 30_000;

let client: Client | null = null;
let guildReady = false;
let commandsSignature = "";
const timers: NodeJS.Timeout[] = [];

// Ключ, которым панель шифрует токен. Лежит в томе бота, в базу попадает только открытая часть.
const secretKey = loadOrCreateBotKey(join(botDataDir(), "secret.key"));
await publishBotKey(prisma, BOT_KEY, secretKey.publicKey);
if (secretKey.source === "generated") log.info("Создан ключ шифрования токена в томе бота");

let token: string | null = null;
let tokenVersion = "";

// Фоновые задачи, привязанные к подключению: при остановке бота они останавливаются тоже.
function every(name: string, fn: () => Promise<void>, ms: number) {
  let running = false;
  timers.push(
    setInterval(() => {
      if (running) return;
      running = true;
      fn()
        .catch((err) => log.error(`Ошибка фоновой задачи «${name}»`, err))
        .finally(() => {
          running = false;
        });
    }, ms),
  );
}

// Регистрирует команды, если они изменились. Подсказки команд зависят от настроек в панели.
async function syncCommands(c: Client, guild: Guild) {
  const body = buildCommands(await getSettings());
  const signature = JSON.stringify(body);
  if (signature === commandsSignature) return;
  await c.rest.put(Routes.applicationGuildCommands(c.application!.id, guild.id), { body });
  commandsSignature = signature;
  log.info("Команды зарегистрированы");
}

// Бот работает только на одном сервере. С чужих серверов уходит сразу.
async function leaveForeignGuild(guild: Guild) {
  if (guild.id === config.GUILD_ID) return;
  log.warn(`Бота розыгрышей добавили на чужой сервер ${guild.id}, выходим`);
  await guild.leave().catch((err) => log.error("Не удалось выйти с сервера", err));
}

async function setupGuild(c: Client, guild: Guild) {
  if (guildReady) return;
  guildReady = true;
  try {
    await syncCommands(c, guild);
  } catch (err) {
    log.error("Не удалось зарегистрировать команды", err);
  }
  log.info(`Работаю на сервере «${guild.name}»`);
  event("bot.start", `Бот розыгрышей запущен на сервере «${guild.name}»`);

  // Итоги подводятся с точностью до 10 секунд, как в прежней версии бота.
  every("розыгрыши", () => tick(guild), 10_000);
  every("команды", () => syncCommands(c, guild), 30_000);
}

function createClient(): Client {
  const c = new Client({
    // Привилегированные интенты не нужны: участников и статус буста бот получает через API.
    intents: [GatewayIntentBits.Guilds],
    // По умолчанию бот никого не пингует. Где нужно упоминание, оно разрешается явно.
    allowedMentions: { parse: [], repliedUser: false },
  });

  c.once(Events.ClientReady, async (ready) => {
    log.info(`Бот розыгрышей запущен как ${ready.user.tag}`);
    await reportBotIdentity(prisma, BOT_KEY, { id: ready.user.id, tag: ready.user.tag, avatar: ready.user.avatar }, null);
    for (const guild of ready.guilds.cache.values()) await leaveForeignGuild(guild);
    const guild = ready.guilds.cache.get(config.GUILD_ID);
    if (!guild) {
      log.warn(`Бот розыгрышей ещё не добавлен на сервер ${config.GUILD_ID}. Жду приглашения по ссылке из README.`);
      return;
    }
    await setupGuild(c, guild);
  });

  c.on(Events.GuildCreate, (guild) => {
    if (guild.id === config.GUILD_ID) void setupGuild(c, guild).catch((err) => log.error("Ошибка запуска на сервере", err));
    else void leaveForeignGuild(guild);
  });
  c.on(Events.InteractionCreate, (interaction) => void handleInteraction(interaction));
  c.on(Events.Error, (err) => log.error("Ошибка клиента Discord", err));
  return c;
}

let lastLoginFailAt = 0;

async function startBot() {
  if (client) return;
  // После неудачного входа ждём 30 секунд, чтобы не долбить Discord каждые 5 секунд.
  if (Date.now() - lastLoginFailAt < 30_000) return;
  if (!token) return;
  const c = createClient();
  client = c;
  try {
    await c.login(token);
    lastLoginFailAt = 0;
  } catch (err) {
    log.error("Не удалось подключиться к Discord", err);
    await reportBotIdentity(prisma, BOT_KEY, null, describeLoginError(err));
    lastLoginFailAt = Date.now();
    client = null;
    await c.destroy().catch(() => undefined);
  }
}

async function stopBot() {
  if (!client) return;
  for (const t of timers.splice(0)) clearInterval(t);
  const c = client;
  client = null;
  guildReady = false;
  commandsSignature = "";
  await c.destroy().catch(() => undefined);
}

let lastState: "running" | "paused" | "failed" | null = null;
let lastBeat = 0;

// Перечитывает токен, если в панели его задали, заменили или удалили. true — токен сменился на ходу.
async function refreshToken(): Promise<boolean> {
  const version = await botTokenVersion(prisma, BOT_KEY);
  if (version === tokenVersion) return false;
  const firstLoad = tokenVersion === "";
  const result = await loadBotToken(prisma, BOT_KEY, secretKey, config.GIVEAWAY_DISCORD_TOKEN);
  // Перенос из .env сам меняет версию — запоминаем уже новую, чтобы не переподключаться дважды.
  tokenVersion = await botTokenVersion(prisma, BOT_KEY);
  lastLoginFailAt = 0;
  if (result.token !== null) {
    token = result.token;
    if (result.source === "env-migrated") {
      log.warn("Токен перенесён из .env в базу (зашифрован). Строку GIVEAWAY_DISCORD_TOKEN из .env можно удалить.");
      event("bot.token_migrated", "Токен бота розыгрышей перенесён из .env в панель, теперь он меняется в разделе «Подключение»");
    }
  } else {
    token = null;
    log.warn(result.error);
    await reportBotIdentity(prisma, BOT_KEY, null, result.error);
  }
  return !firstLoad;
}

// Раз в несколько секунд сверяемся с панелью: включить или выключить подключение к Discord.
async function supervise() {
  const enabled = await isBotEnabled(prisma, BOT_KEY);
  if ((await refreshToken()) && client) {
    log.info("Токен изменён в панели, переподключаюсь");
    event("bot.token_changed", "Токен бота розыгрышей изменён в панели, бот переподключился");
    await stopBot();
  }
  const hasToken = token !== null;

  if (enabled && hasToken && !client) {
    if (lastState === "paused" || lastState === "failed") {
      log.info("Запуск по команде из панели");
      event("bot.resumed", "Бот розыгрышей запущен из панели");
    }
    await startBot();
  } else if (!enabled && client) {
    log.info("Остановка по команде из панели");
    await stopBot();
    event("bot.paused", "Бот розыгрышей остановлен из панели: отключён от Discord, итоги не подводятся до запуска", { level: "WARN" });
  }

  const state = client ? "running" : enabled && (!hasToken || lastLoginFailAt > 0) ? "failed" : "paused";
  if (state !== lastState || Date.now() - lastBeat > HEARTBEAT_MS) {
    await reportBotState(prisma, BOT_KEY, state);
    lastState = state;
    lastBeat = Date.now();
  }
}

let supervising = false;
async function loop() {
  if (supervising) return;
  supervising = true;
  try {
    await supervise();
  } catch (err) {
    log.error("Ошибка проверки команды из панели", err);
  } finally {
    supervising = false;
  }
}

process.on("unhandledRejection", (err) => log.error("Необработанная ошибка", err));

async function shutdown(signal: string) {
  log.info(`Получен ${signal}, останавливаемся`);
  await stopBot();
  await prisma.$disconnect();
  process.exit(0);
}
process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));

await loop();
setInterval(() => void loop(), CONTROL_POLL_MS);
