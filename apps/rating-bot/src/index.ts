import { Client, Events, GatewayIntentBits, Partials, Routes, type Guild } from "discord.js";
import { ensureRatingDefaults, prisma } from "@flamebot/core";
import { commands } from "./commands/index.js";
import { config } from "./config.js";
import { handleInteraction } from "./interactions.js";
import { log } from "./logger.js";
import { event } from "./services/events.js";
import { heartbeat, scheduleSnapshot, syncGuildSnapshot } from "./services/guildSync.js";
import { startJobs } from "./services/jobs.js";
import { handleMessageXp } from "./services/xp.js";

const client = new Client({
  // Только то, что нужно: сервер, сообщения и их текст (для минимальной длины).
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent],
  partials: [Partials.GuildMember],
  // По умолчанию бот никого не пингует. Где нужно упоминание, оно разрешается явно.
  allowedMentions: { parse: [], repliedUser: false },
});

const timers: NodeJS.Timeout[] = [];

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

let guildReady = false;

// Запуск работы на нашем сервере. Вызывается при старте или когда бота пригласили позже.
async function setupGuild(guild: Guild) {
  if (guildReady) return;
  guildReady = true;

  // Регистрируем команды при каждом запуске: так они всегда совпадают с кодом.
  try {
    await client.rest.put(Routes.applicationGuildCommands(client.application!.id, guild.id), {
      body: commands.map((cmd) => cmd.data),
    });
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

client.once(Events.ClientReady, async (c) => {
  log.info(`Бот запущен как ${c.user.tag}`);
  await ensureRatingDefaults(prisma);

  for (const guild of c.guilds.cache.values()) await leaveForeignGuild(guild);

  const guild = c.guilds.cache.get(config.GUILD_ID);
  if (!guild) {
    log.warn(`Бот ещё не добавлен на сервер ${config.GUILD_ID}. Жду приглашения по ссылке из README.`);
    return;
  }
  await setupGuild(guild);
});

client.on(Events.GuildCreate, (guild) => {
  if (guild.id === config.GUILD_ID) void setupGuild(guild).catch((err) => log.error("Ошибка запуска на сервере", err));
  else void leaveForeignGuild(guild);
});
client.on(Events.MessageCreate, (message) => void handleMessageXp(message));
client.on(Events.InteractionCreate, (interaction) => void handleInteraction(interaction));

for (const event of [
  Events.GuildRoleCreate,
  Events.GuildRoleUpdate,
  Events.GuildRoleDelete,
  Events.ChannelCreate,
  Events.ChannelUpdate,
  Events.ChannelDelete,
] as const) {
  client.on(event, () => {
    const guild = client.guilds.cache.get(config.GUILD_ID);
    if (guild) scheduleSnapshot(guild);
  });
}

client.on(Events.GuildMemberRemove, (member) => {
  if (member.guild.id !== config.GUILD_ID) return;
  void prisma.member.updateMany({ where: { id: member.id }, data: { inGuild: false } }).catch(() => undefined);
});

client.on(Events.Error, (err) => log.error("Ошибка клиента Discord", err));
process.on("unhandledRejection", (err) => log.error("Необработанная ошибка", err));

async function shutdown(signal: string) {
  log.info(`Получен ${signal}, останавливаемся`);
  for (const t of timers) clearInterval(t);
  await client.destroy();
  await prisma.$disconnect();
  process.exit(0);
}
process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));

await client.login(config.DISCORD_TOKEN);
