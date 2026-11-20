import type { KeyObject } from "node:crypto";
import {
  ONLINE_TELEGRAM_TOKEN_CONTEXT,
  formatDowntime,
  onlineDownMessage,
  onlineUpMessage,
  openSecret,
  planOnlineAlerts,
  prisma,
  serversCount,
  type AlertMemory,
  type AlertServer,
  type OnlineTelegram,
} from "@flamebot/core";
import { Telegram, TelegramError, TelegramNetworkError } from "@flamebot/core/telegram";
import { event, log } from "./events.js";
import type { ServerWorker } from "./worker.js";

const LOGIN_RETRY_MS = 60_000;
// Очередь на чат: Telegram недоступен — сообщения ждут, но не больше 20 штук и не дольше 6 часов.
const OUTBOX_LIMIT = 20;
const OUTBOX_MAX_AGE_MS = 6 * 3_600_000;
const NETWORK_RETRY_MS = 10_000;

// Понятная причина, почему сообщение не дошло до чата.
function chatError(err: unknown): string {
  if (err instanceof TelegramError) {
    if (err.code === 403) return "бот не может писать в этот чат: напиши боту /start или добавь его в группу или канал";
    if (err.code === 400 && /chat not found/i.test(err.description)) return "чат не найден: проверь ID и что бот добавлен в чат";
    if (err.code === 429) return `Telegram просит подождать ${err.retryAfter ?? "несколько"} с`;
    return err.message;
  }
  return err instanceof Error ? err.message : String(err);
}

const temporary = (err: unknown) => err instanceof TelegramNetworkError || (err instanceof TelegramError && err.code === 429);

// Уведомления в Telegram о выключении и включении серверов.
// Что уже сообщили, хранится в OnlineServerStatus.alertState: после перезапуска бот
// не повторит уведомление и не потеряет «сервер снова работает».
export class TelegramNotifier {
  private tg: Telegram | null = null;
  private tokenEnc: string | null = null;
  private loginRetryAt = 0;
  // Номер подключения: старый цикл чтения сообщений останавливается, когда токен сменили.
  private generation = 0;
  // Неотправленные сообщения по чатам и до какого времени чат просил подождать.
  private readonly outbox = new Map<string, { text: string; what: string; at: number }[]>();
  private readonly chatWaitUntil = new Map<string, number>();
  // Когда серверы упали и поднялись — чтобы собрать один рестарт в одно сообщение.
  private readonly memory: AlertMemory = { downAt: new Map(), upAt: new Map() };

  constructor(private readonly privateKey: KeyObject) {}

  async tick(workers: ServerWorker[]): Promise<void> {
    const cfg = await prisma.onlineTelegram.upsert({ where: { id: 1 }, update: {}, create: { id: 1 } });
    await this.syncToken(cfg);
    if (cfg.testRequestedAt && (!cfg.testDoneAt || cfg.testDoneAt < cfg.testRequestedAt)) await this.sendTest(cfg);
    await this.checkServers(cfg, workers);
    await this.flush(cfg);
  }

  // Бота остановили из панели: перестаём читать сообщения, уведомления не шлём.
  pause(): void {
    this.generation++;
    this.tg = null;
    this.tokenEnc = null;
    // После включения устаревшие сообщения не досылаем.
    this.outbox.clear();
    this.chatWaitUntil.clear();
  }

  // ---------- Подключение ----------

  private async syncToken(cfg: OnlineTelegram) {
    const changed = cfg.tokenEnc !== this.tokenEnc;
    if (!changed && (this.tg || !cfg.tokenEnc || Date.now() < this.loginRetryAt)) return;
    this.tokenEnc = cfg.tokenEnc;
    // Неверный токен не пробуем снова, пока его не заменят в панели.
    this.loginRetryAt = Infinity;
    this.generation++;
    this.tg = null;

    if (!cfg.tokenEnc) {
      if (changed) await this.saveBot(null, null);
      return;
    }
    let token: string;
    try {
      token = openSecret(this.privateKey, cfg.tokenEnc, ONLINE_TELEGRAM_TOKEN_CONTEXT);
    } catch {
      await this.saveBot(null, "Токен не расшифровывается: введи его в панели заново");
      return;
    }
    const tg = new Telegram(token);
    try {
      const me = await tg.getMe();
      this.tg = tg;
      await this.saveBot(me.username ?? String(me.id), null);
      log("info", `Telegram: вошли как @${me.username}`);
      event("telegram.connected", `Telegram: бот уведомлений подключён как @${me.username}`);
      void this.listen(tg, this.generation);
    } catch (err) {
      if (err instanceof TelegramError && (err.code === 401 || err.code === 404)) {
        await this.saveBot(null, "Telegram не принял токен: проверь его в @BotFather и введи заново");
        log("error", "Telegram не принял токен бота уведомлений");
      } else {
        // Telegram временно недоступен: пробуем снова через минуту.
        this.loginRetryAt = Date.now() + LOGIN_RETRY_MS;
        await this.saveBot(null, `Не удалось подключиться к Telegram: ${chatError(err)}. Повторим через минуту`);
        log("warn", "Не удалось подключиться к Telegram", err);
      }
    }
  }

  private async saveBot(botUsername: string | null, botError: string | null) {
    await prisma.onlineTelegram.update({ where: { id: 1 }, data: { botUsername, botError } }).catch(() => undefined);
  }

  // Отвечает на /id и /start идентификатором чата: так проще всего узнать, что вписать в панель.
  private async listen(tg: Telegram, generation: number) {
    let offset = 0;
    while (generation === this.generation) {
      try {
        const updates = await tg.getUpdates(offset, 50, ["message", "channel_post"]);
        if (generation !== this.generation) return;
        for (const u of updates) {
          offset = u.update_id + 1;
          const msg = u.message ?? u.channel_post;
          const cmd = msg?.text?.trim().split(/[\s@]/)[0];
          if (!msg || (cmd !== "/id" && cmd !== "/start")) continue;
          const where = msg.chat.type === "private" ? "этого чата" : msg.chat.type === "channel" ? "этого канала" : "этой группы";
          await tg
            .sendMessage(msg.chat.id, `ID ${where}: ${msg.chat.id}\n\nВставь его в панели: «Онлайн серверов» → «Telegram» → «Получатели».`, null, false)
            .catch((err) => log("warn", "Telegram: не удалось ответить на /id", err));
        }
      } catch (err) {
        if (generation !== this.generation) return;
        if (err instanceof TelegramError && err.code === 409) {
          // Тот же токен читает другой бот. Уведомления работают и так, а отбирать у него сообщения нельзя.
          log("warn", "Telegram: этот токен уже использует другая программа, команда /id отключена. Для уведомлений лучше завести отдельного бота");
          return;
        }
        if (err instanceof TelegramError && (err.code === 401 || err.code === 404)) {
          this.tg = null;
          this.loginRetryAt = Infinity;
          await this.saveBot(null, "Telegram отозвал токен: введи новый в панели");
          return;
        }
        await new Promise((r) => setTimeout(r, 10_000));
      }
    }
  }

  // ---------- Отправка ----------

  // Отправляет текст во все чаты. temporary — не дошло никуда из-за сети: стоит повторить позже.
  private async sendAll(cfg: OnlineTelegram, text: string): Promise<{ sent: number; errors: string[]; temporary: boolean }> {
    const errors: string[] = [];
    let sent = 0;
    let tempFails = 0;
    for (const chat of cfg.chatIds) {
      try {
        await this.tg!.sendMessage(chat, text, null, false);
        sent++;
      } catch (err) {
        if (temporary(err)) tempFails++;
        errors.push(`${chat}: ${chatError(err)}`);
      }
    }
    return { sent, errors, temporary: sent === 0 && tempFails > 0 };
  }

  private async sendTest(cfg: OnlineTelegram) {
    let ok = false;
    let result: string;
    if (!this.tg) result = cfg.botError ?? "Бот Telegram не подключён: введи токен";
    else if (!cfg.chatIds.length) result = "Не указан ни один получатель";
    else {
      const r = await this.sendAll(cfg, "✅ Проверка связи: уведомления о серверах будут приходить сюда.");
      ok = r.errors.length === 0;
      result = ok ? `Отправлено во все чаты (${r.sent})` : `Отправлено в ${r.sent} из ${cfg.chatIds.length}. ${r.errors.join("; ")}`;
    }
    await prisma.onlineTelegram.update({ where: { id: 1 }, data: { testDoneAt: new Date(), testResult: result.slice(0, 1000), testOk: ok } });
  }

  // ---------- Очередь сообщений ----------

  // Ставит сообщение в очередь каждого чата. Отправка — в flush(), с учётом ограничений Telegram.
  private enqueue(cfg: OnlineTelegram, text: string, what: string) {
    if (!cfg.chatIds.length) return;
    for (const chat of cfg.chatIds) {
      const queue = this.outbox.get(chat) ?? [];
      queue.push({ text, what, at: Date.now() });
      // Чат долго недоступен: старое выбрасываем, чтобы очередь не росла бесконечно.
      while (queue.length > OUTBOX_LIMIT) queue.shift();
      this.outbox.set(chat, queue);
    }
  }

  // По одному сообщению в чат за такт (раз в 3 с): Telegram пускает в группу около 20 сообщений в минуту.
  // Если Telegram просит подождать, ждём ровно столько, сколько он сказал, и только этот чат.
  private async flush(cfg: OnlineTelegram) {
    if (!this.tg) return;
    const now = Date.now();
    for (const [chat, queue] of this.outbox) {
      if (!cfg.chatIds.includes(chat)) {
        this.outbox.delete(chat);
        continue;
      }
      while (queue.length && now - queue[0]!.at > OUTBOX_MAX_AGE_MS) {
        log("warn", `Telegram: ${queue.shift()!.what} — не удалось доставить в ${chat} за ${OUTBOX_MAX_AGE_MS / 3_600_000} ч, сообщение пропущено`);
      }
      const head = queue[0];
      if (!head || (this.chatWaitUntil.get(chat) ?? 0) > now) continue;
      try {
        await this.tg.sendMessage(chat, head.text, null, false);
        queue.shift();
        event("telegram.sent", `Telegram: ${head.what} — отправлено в ${chat}`);
      } catch (err) {
        if (err instanceof TelegramError && err.code === 429) {
          this.chatWaitUntil.set(chat, now + (err.retryAfter ?? 5) * 1000);
        } else if (temporary(err)) {
          this.chatWaitUntil.set(chat, now + NETWORK_RETRY_MS);
        } else {
          // Чат недоступен насовсем (бота удалили, нет прав): повторять бессмысленно.
          queue.shift();
          log("warn", `Telegram: ${head.what} — не дошло до ${chat}: ${chatError(err)}`);
        }
      }
    }
  }

  // Сверяет, что видят воркеры, с тем, что уже сообщили в Telegram.
  // Что и когда сообщать, решает planOnlineAlerts: упавшие вместе — одним сообщением,
  // включения ждут остальных серверов того же рестарта.
  private async checkServers(cfg: OnlineTelegram, workers: ServerWorker[]) {
    if (!workers.length) return;
    const rows = await prisma.onlineServerStatus.findMany({
      where: { serverId: { in: workers.map((w) => w.id) } },
      select: { serverId: true, alertState: true, downSince: true, downNotifiedAt: true },
    });
    const byId = new Map(rows.map((r) => [r.serverId, r]));
    const live = new Map<number, { worker: ServerWorker; snap: ReturnType<ServerWorker["snapshot"]> }>();
    const servers: AlertServer[] = [];
    for (const w of workers) {
      const row = byId.get(w.id);
      if (!row) continue; // воркер ещё не записал статус
      const snap = w.snapshot();
      live.set(w.id, { worker: w, snap });
      servers.push({
        id: w.id,
        online: snap.state === "ONLINE",
        offlineSince: snap.offlineSince,
        alertState: row.alertState,
        downSince: row.downSince?.getTime() ?? null,
        downNotifiedAt: row.downNotifiedAt?.getTime() ?? null,
      });
    }

    const now = Date.now();
    const plan = planOnlineAlerts(servers, this.memory, now, cfg.delaySec * 1000);
    const name = (id: number) => live.get(id)!.worker.name;

    if (plan.down.length && cfg.notifyOffline) {
      const names = plan.down.map(name);
      this.enqueue(cfg, onlineDownMessage(cfg, names), names.length === 1 ? `«${names[0]}» выключился` : `выключились ${serversCount(names.length)}`);
    }
    if (plan.up.length && cfg.notifyOnline) {
      const items = plan.up.map((id) => {
        const { snap } = live.get(id)!;
        const since = servers.find((s) => s.id === id)!.downSince!;
        return { server: name(id), downtime: formatDowntime(now - since), players: snap.players, max: snap.max };
      });
      const what = items.length === 1 ? `«${items[0]!.server}» снова работает` : `снова работают ${serversCount(items.length)}`;
      this.enqueue(cfg, onlineUpMessage(cfg, items, plan.waiting.map(name)), what);
    }

    for (const [serverId, u] of plan.updates) {
      await prisma.onlineServerStatus.update({
        where: { serverId },
        data: {
          alertState: u.alertState,
          downSince: u.downSince === null ? null : new Date(u.downSince),
          downNotifiedAt: u.downNotifiedAt === null ? null : new Date(u.downNotifiedAt),
        },
      });
    }
  }
}
