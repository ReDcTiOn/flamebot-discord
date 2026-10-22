import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { z } from "zod";
import { Prisma, STEAM_ID, cleanSteamName, generateLinkCode, hashLinkKey, prisma, type LinkServer } from "@flamebot/core";
import { config } from "./config.js";
import { log } from "./events.js";
import { RateLimiter, getSettings, live, unix } from "./util.js";

// HTTP API для плагина на игровых серверах. Каждый сервер ходит со своим ключом из панели
// («Привязка Steam» → «Серверы»). Запросы:
//   GET  /link-api/v1/ping    — проверка ключа и связи;
//   POST /link-api/v1/code    — код для /connect: { steamId, name };
//   POST /link-api/v1/lookup  — чьи Steam уже привязаны: { steamIds: [...] }.
// Префикс /link-api можно не писать: Caddy передаёт путь как есть.

const MAX_BODY = 16 * 1024;
const LOOKUP_MAX = 200;

class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

// Неверный ключ — не больше 20 раз за 10 минут с одного адреса, дальше 429.
const authFailures = new RateLimiter(20, 10 * 60_000);
// Один сервер — не больше 600 запросов в минуту: этого хватает с запасом, а зациклившийся плагин не положит бота.
const perServer = new RateLimiter(600, 60_000);

function send(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  res.end(JSON.stringify(body));
}

// Порт открыт только для Caddy на этом же сервере, поэтому X-Forwarded-For можно верить: его ставит Caddy.
function clientIp(req: IncomingMessage): string {
  const forwarded = req.headers["x-forwarded-for"];
  const first = (Array.isArray(forwarded) ? forwarded[0] : forwarded)?.split(",")[0]?.trim();
  return first || req.socket.remoteAddress || "unknown";
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  if (!/^application\/json\b/i.test(req.headers["content-type"] ?? "")) throw new HttpError(415, "Нужен JSON (Content-Type: application/json)");
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req as AsyncIterable<Buffer>) {
    size += chunk.length;
    if (size > MAX_BODY) throw new HttpError(413, "Слишком большой запрос");
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new HttpError(400, "Неверный JSON");
  }
}

// Ключи сверяются по SHA-256. Найденный сервер помним 30 секунд, чтобы не ходить в базу на каждый запрос;
// поэтому отключение сервера или смена ключа в панели доходят до бота за полминуты.
const servers = new Map<string, { server: LinkServer; at: number }>();
const seenAt = new Map<number, number>();

async function authenticate(req: IncomingMessage): Promise<LinkServer> {
  const ip = clientIp(req);
  if (authFailures.full(ip)) throw new HttpError(429, "Слишком много запросов с неверным ключом. Подожди 10 минут.");

  const match = /^Bearer\s+(\S+)$/i.exec(req.headers.authorization ?? "");
  const hash = match ? hashLinkKey(match[1]!) : null;
  let cached = hash ? servers.get(hash) : undefined;
  if (hash && (!cached || Date.now() - cached.at > 30_000)) {
    const server = await prisma.linkServer.findUnique({ where: { keyHash: hash } });
    if (server) servers.set(hash, (cached = { server, at: Date.now() }));
    else {
      servers.delete(hash);
      cached = undefined;
    }
  }
  if (!cached) {
    authFailures.take(ip);
    log.warn(`Запрос к API привязки с неверным ключом с адреса ${ip}`);
    throw new HttpError(401, "Неверный ключ API. Возьми ключ в панели: «Привязка Steam» → «Игровые серверы».");
  }
  const { server } = cached;
  if (!server.enabled) throw new HttpError(403, "Этот сервер отключён в панели");
  if (!perServer.take(String(server.id))) throw new HttpError(429, "Слишком много запросов");

  // Время последнего запроса для панели — не чаще раза в минуту.
  if (Date.now() - (seenAt.get(server.id) ?? 0) > 60_000) {
    seenAt.set(server.id, Date.now());
    void prisma.linkServer.update({ where: { id: server.id }, data: { lastSeenAt: new Date() } }).catch(() => undefined);
  }
  return server;
}

const codeSchema = z.object({
  steamId: z.string().regex(STEAM_ID, "Неверный SteamID"),
  name: z.string().max(256).optional().default(""),
});

const lookupSchema = z.object({
  steamIds: z.array(z.string().regex(STEAM_ID, "Неверный SteamID")).max(LOOKUP_MAX, `Не больше ${LOOKUP_MAX} SteamID за раз`),
});

function parse<T>(schema: z.ZodType<T>, body: unknown): T {
  const result = schema.safeParse(body);
  if (!result.success) throw new HttpError(400, result.error.issues[0]?.message ?? "Неверный запрос");
  return result.data;
}

// Код для /connect. Пока прежний код действует, отдаём его же: повторный /connect не плодит коды.
async function issueCode(server: LinkServer, body: unknown) {
  const { steamId, name } = parse(codeSchema, body);
  const steamName = cleanSteamName(name);

  const link = await prisma.steamLink.findUnique({ where: { steamId } });
  if (link) return { status: "linked", discordId: link.discordId, discordName: link.discordName, linkedAt: unix(link.linkedAt) };

  const s = await getSettings();
  const guild = live.guild;
  if (!guild) return { status: "unavailable", message: "Бот привязки сейчас не в сети. Попробуй позже." };
  const channel = s.channelId ? guild.channels.cache.get(s.channelId) : undefined;
  if (!channel) return { status: "unavailable", message: "Привязка ещё не настроена. Попробуй позже." };

  const now = new Date();
  const existing = await prisma.linkCode.findUnique({ where: { steamId } });
  if (existing && existing.expiresAt > now) {
    return { status: "code", code: existing.code, expiresAt: unix(existing.expiresAt), ttlSeconds: unix(existing.expiresAt) - unix(now), channel: channel.name };
  }

  const expiresAt = new Date(now.getTime() + s.codeTtlMinutes * 60_000);
  // Совпадение кода с чужим маловероятно (31⁶ вариантов), но возможно: тогда берём другой.
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = generateLinkCode();
    try {
      const data = { code, steamName, serverId: server.id, expiresAt, createdAt: now };
      await prisma.linkCode.upsert({ where: { steamId }, create: { steamId, ...data }, update: data });
      return { status: "code", code, expiresAt: unix(expiresAt), ttlSeconds: s.codeTtlMinutes * 60, channel: channel.name };
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") continue;
      throw err;
    }
  }
  throw new Error("Не удалось подобрать свободный код");
}

async function lookup(body: unknown) {
  const { steamIds } = parse(lookupSchema, body);
  if (steamIds.length === 0) return { links: [] };
  const rows = await prisma.steamLink.findMany({ where: { steamId: { in: [...new Set(steamIds)] } } });
  return {
    links: rows.map((r) => ({ steamId: r.steamId, discordId: r.discordId, discordName: r.discordName, linkedAt: unix(r.linkedAt) })),
  };
}

async function handle(req: IncomingMessage, res: ServerResponse) {
  const path = new URL(req.url ?? "/", "http://localhost").pathname.replace(/^\/link-api(?=\/)/, "").replace(/\/+$/, "");
  const route = `${req.method} ${path}`;
  if (route === "GET /health") return send(res, 200, { ok: true });

  const server = await authenticate(req);
  if (route === "GET /v1/ping") return send(res, 200, { ok: true, server: server.name, discord: live.guild !== null });
  if (route === "POST /v1/code") {
    const result = await issueCode(server, await readJson(req));
    return send(res, result.status === "unavailable" ? 503 : 200, result);
  }
  if (route === "POST /v1/lookup") return send(res, 200, await lookup(await readJson(req)));
  throw new HttpError(404, "Нет такого адреса");
}

export function startApi(): Server {
  const server = createServer((req, res) => {
    handle(req, res).catch((err: unknown) => {
      if (err instanceof HttpError) {
        if (!res.headersSent) send(res, err.status, { status: "error", message: err.message });
        // Недочитанное тело (слишком большой запрос) не дочитываем: закрываем соединение.
        if (err.status === 413) req.destroy();
        return;
      }
      log.error("Ошибка API привязки", err);
      if (!res.headersSent) send(res, 500, { status: "error", message: "Внутренняя ошибка бота" });
    });
  });
  server.requestTimeout = 10_000;
  server.headersTimeout = 10_000;
  server.on("error", (err) => log.error("HTTP API привязки не запустился", err));
  server.listen(config.LINK_API_PORT, config.LINK_API_HOST, () => {
    log.info(`API для игровых серверов слушает ${config.LINK_API_HOST}:${config.LINK_API_PORT}`);
  });
  return server;
}

// Истёкшие коды больше никому не нужны.
export async function cleanupCodes(): Promise<void> {
  const { count } = await prisma.linkCode.deleteMany({ where: { expiresAt: { lt: new Date(Date.now() - 60 * 60_000) } } });
  if (count > 0) log.info(`Удалено истёкших кодов: ${count}`);
}
