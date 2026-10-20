import { Client, Events, GatewayIntentBits, Partials, Routes, type Guild } from "discord.js";
import { ensureRatingDefaults, isBotEnabled, prisma, reportBotState } from "@flamebot/core";
import { commands } from "./commands/index.js";
import { rememberCommandIds } from "./commands/mention.js";
import { config } from "./config.js";
import { handleInteraction } from "./interactions.js";
import { log } from "./logger.js";
import { event } from "./services/events.js";
import { BOT_KEY, heartbeat, scheduleSnapshot, syncGuildSnapshot } from "./services/guildSync.js";
import { startJobs } from "./services/jobs.js";
import { handleMessageXp } from "./services/xp.js";

// Процесс бота работает всегда, а подключение к Discord включается и выключается из панели
// (таблица BotControl). Выключенный бот выходит из Discord и ждёт команды на запуск.
const CONTROL_POLL_MS = 5_000;
const HEARTBEAT_MS = 30_000;

let client: Client | null = null;
let guildReady = false;
const timers: NodeJS.Timeout[] = [];

// Фоновые задачи, привязанные к подключению: при остановке бота они останавливаются тоже.
function every(fn: () => Promise<void>, ms: number) {
  let running = false;
  timers.push(
    setInterval(() => {
      if (running) return;
      running = true;
      fn()
        .catch((err) => log.error("Ошибка фоновой задачи", err))
        .finally(() => {
          running = false;
        });
    }, ms),
  );
}

// Бот работает только на одном сервере. С чужих серверов уходит сразу.
async function leaveForeignGuild(guild: Guild) {
  if (guild.id === config.GUILD_ID) return;
  log.warn(`Бота добавили на чужой сервер ${guild.id}, выходим`);
  await guild.leave().catch((err) => log.error("Не удалось выйти с сервера", err));
}

// Запуск работы на нашем сервере. Вызывается при подключении или когда бота пригласили позже.
async function setupGuild(c: Client, guild: Guild) {
  if (guildReady) return;
  guildReady = true;

  // Регистрируем команды при каждом запуске: так они всегда совпадают с кодом.
  try {
    const registered = (await c.rest.put(Routes.applicationGuildCommands(c.application!.id, guild.id), {
      body: commands.map((cmd) => cmd.data),
    })) as { id: string; name: string }[];
    rememberCommandIds(registered);
    log.info(`Команды зарегистрированы: ${commands.length}`);
  } catch (err) {
    log.error("Не удалось зарегистрировать команды", err);
  }

  await guild.roles.fetch();
  await guild.channels.fetch();
  await syncGuildSnapshot(guild);
  await heartbeat(guild);
  log.info(`Работаю на сервере «${guild.name}»`);
  event("bot.start", `Бот запущен на сервере «${guild.name}»`, { details: { members: guild.memberCount } });

  every(() => heartbeat(guild), 60_000);
  every(() => syncGuildSnapshot(guild), 15 * 60_000);
  startJobs(guild, every);
}

function createClient(): Client {
  const c = new Client({
    // Только то, что нужно: сервер, сообщения и их текст (для минимальной длины).
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent],
    partials: [Partials.GuildMember],
    // По умолчанию бот никого не пингует. Где нужно упоминание, оно разрешается явно.
    allowedMentions: { parse: [], repliedUser: false },
  });

  c.once(Events.ClientReady, async (ready) => {
    log.info(`Бот запущен как ${ready.user.tag}`);
    await ensureRatingDefaults(prisma);
    for (const guild of ready.guilds.cache.values()) await leaveForeignGuild(guild);

    const guild = ready.guilds.cache.get(config.GUILD_ID);
    if (!guild) {
      log.warn(`Бот ещё не добавлен на сервер ${config.GUILD_ID}. Жду приглашения по ссылке из README.`);
      return;
    }
    await setupGuild(c, guild);
  });

  c.on(Events.GuildCreate, (guild) => {
    if (guild.id === config.GUILD_ID) void setupGuild(c, guild).catch((err) => log.error("Ошибка запуска на сервере", err));
    else void leaveForeignGuild(guild);
  });
  c.on(Events.MessageCreate, (message) => void handleMessageXp(message));
  c.on(Events.InteractionCreate, (interaction) => void handleInteraction(interaction));

  for (const name of [
    Events.GuildRoleCreate,
    Events.GuildRoleUpdate,
    Events.GuildRoleDelete,
    Events.ChannelCreate,
    Events.ChannelUpdate,
    Events.ChannelDelete,
  ] as const) {
    c.on(name, () => {
      const guild = c.guilds.cache.get(config.GUILD_ID);
      if (guild) scheduleSnapshot(guild);
    });
  }

  c.on(Events.GuildMemberRemove, (member) => {
    if (member.guild.id !== config.GUILD_ID) return;
    void prisma.member.updateMany({ where: { id: member.id }, data: { inGuild: false } }).catch(() => undefined);
  });

  c.on(Events.Error, (err) => log.error("Ошибка клиента Discord", err));
  return c;
}

let lastLoginFailAt = 0;

async function startBot() {
  if (client) return;
  // После неудачного входа ждём 30 секунд, чтобы не долбить Discord каждые 5 секунд.
  if (Date.now() - lastLoginFailAt < 30_000) return;
  const c = createClient();
  client = c;
  try {
    await c.login(config.DISCORD_TOKEN);
    lastLoginFailAt = 0;
  } catch (err) {
    log.error("Не удалось подключиться к Discord", err);
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
  await c.destroy().catch(() => undefined);
}

let lastState: "running" | "paused" | "failed" | null = null;
let lastBeat = 0;

// Раз в несколько секунд сверяемся с панелью: включить или выключить подключение к Discord.
async function supervise() {
  const enabled = await isBotEnabled(prisma, BOT_KEY);
  if (enabled && !client) {
    if (lastState === "paused" || lastState === "failed") {
      log.info("Запуск по команде из панели");
      event("bot.resumed", "Бот запущен из панели");
    }
    await startBot();
  } else if (!enabled && client) {
    log.info("Остановка по команде из панели");
    await stopBot();
    event("bot.paused", "Бот остановлен из панели: отключён от Discord", { level: "WARN" });
  }

  const state = client ? "running" : enabled && lastLoginFailAt > 0 ? "failed" : "paused";
  if (state !== lastState || Date.now() - lastBeat > HEARTBEAT_MS) {
    await reportBotState(prisma, BOT_KEY, state);
    lastState = state;
    lastBeat = Date.now();
  }
}

let supervising = false;
async function tick() {
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

await tick();
setInterval(() => void tick(), CONTROL_POLL_MS);
