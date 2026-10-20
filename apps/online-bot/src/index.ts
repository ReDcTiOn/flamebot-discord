import { loadPrivateKey, openSecret, prisma, secretContext, type OnlineServer, type OnlineSettings } from "@flamebot/core";
import { config } from "./config.js";
import { BOT_KEY, event, log } from "./events.js";
import { ServerWorker } from "./worker.js";

const RECONCILE_MS = 10_000;

const { key: privateKey, publicKey } = loadPrivateKey(config.ONLINE_SECRET_KEY);
const workers = new Map<number, { worker: ServerWorker; signature: string }>();

async function getSettings(): Promise<OnlineSettings> {
  return prisma.onlineSettings.upsert({ where: { id: 1 }, update: {}, create: { id: 1 } });
}

function decrypt(server: OnlineServer, field: "rconPassword" | "discordToken", sealed: string | null): string | null {
  if (!sealed) return null;
  return openSecret(privateKey, sealed, secretContext("online", server.id, field));
}

// Сверяет запущенные серверы с базой: новые запускает, изменённые перезапускает, удалённые останавливает.
async function reconcile(): Promise<void> {
  const [settings, servers] = await Promise.all([getSettings(), prisma.onlineServer.findMany({ orderBy: { id: "asc" } })]);
  const wanted = new Set<number>();

  for (const s of servers) {
    if (!s.enabled) {
      if (workers.has(s.id)) await stopWorker(s.id);
      await prisma.onlineServerStatus.upsert({
        where: { serverId: s.id },
        create: { serverId: s.id, state: "DISABLED" },
        update: { state: "DISABLED", players: null, maxPlayers: null, queued: null },
      });
      continue;
    }
    wanted.add(s.id);
    const signature = JSON.stringify([s.host, s.port, s.secretsUpdatedAt?.getTime(), s.name, settings.updatedAt.getTime()]);
    if (workers.get(s.id)?.signature === signature) continue;
    if (workers.has(s.id)) await stopWorker(s.id);

    let secrets: { rconPassword: string | null; discordToken: string | null };
    try {
      secrets = { rconPassword: decrypt(s, "rconPassword", s.rconPasswordEnc), discordToken: decrypt(s, "discordToken", s.discordTokenEnc) };
    } catch {
      log("error", `«${s.name}»: не удалось расшифровать секреты. Введи пароль RCON и токен заново в панели.`);
      await prisma.onlineServerStatus.upsert({
        where: { serverId: s.id },
        create: { serverId: s.id, state: "OFFLINE", botError: "Секреты не расшифровываются: введи их заново" },
        update: { state: "OFFLINE", botError: "Секреты не расшифровываются: введи их заново" },
      });
      workers.set(s.id, { worker: new ServerWorker(s, { rconPassword: null, discordToken: null }, settings, config.ALLOW_PRIVATE_RCON), signature });
      continue;
    }

    const worker = new ServerWorker(s, secrets, settings, config.ALLOW_PRIVATE_RCON);
    workers.set(s.id, { worker, signature });
    log("info", `«${s.name}»: запуск`);
    worker.start();
  }

  for (const id of [...workers.keys()]) if (!wanted.has(id)) await stopWorker(id);
}

async function stopWorker(id: number) {
  const w = workers.get(id);
  workers.delete(id);
  if (w) await w.worker.stop();
}

async function heartbeat() {
  await prisma.botStatus.upsert({
    where: { botKey: BOT_KEY },
    create: { botKey: BOT_KEY, heartbeatAt: new Date() },
    update: { heartbeatAt: new Date() },
  });
}

// Периодическая задача: следующий запуск не начнётся, пока не закончился предыдущий.
function every(name: string, fn: () => Promise<void>, ms: number) {
  let running = false;
  setInterval(() => {
    if (running) return;
    running = true;
    fn()
      .catch((err) => log("error", `Ошибка фоновой задачи «${name}»`, err))
      .finally(() => {
        running = false;
      });
  }, ms);
}

async function main() {
  // Публикуем открытый ключ: панель шифрует им секреты, расшифровать может только этот бот.
  await prisma.botPublicKey.upsert({ where: { botKey: BOT_KEY }, create: { botKey: BOT_KEY, publicKey }, update: { publicKey } });
  await heartbeat();
  event("bot.start", "Бот онлайна запущен");
  log("info", "Бот онлайна запущен");
  await reconcile();
  every("сверка серверов", reconcile, RECONCILE_MS);
  every("статус бота", heartbeat, 60_000);
}

async function shutdown(signal: string) {
  log("info", `Получен ${signal}, останавливаемся`);
  for (const id of [...workers.keys()]) await stopWorker(id);
  await prisma.$disconnect();
  process.exit(0);
}
process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("unhandledRejection", (err) => log("error", "Необработанная ошибка", err));

await main();
