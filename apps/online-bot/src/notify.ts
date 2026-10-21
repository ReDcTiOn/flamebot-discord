import type { KeyObject } from "node:crypto";
import {
  ONLINE_TELEGRAM_TOKEN_CONTEXT,
  formatDowntime,
  onlineTelegramText,
  openSecret,
  prisma,
  type OnlineTelegram,
  type Prisma,
} from "@flamebot/core";
import { Telegram, TelegramError, TelegramNetworkError } from "@flamebot/core/telegram";
import { event, log } from "./events.js";
import type { ServerWorker } from "./worker.js";

const LOGIN_RETRY_MS = 60_000;

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

  constructor(private readonly privateKey: KeyObject) {}

  async tick(workers: ServerWorker[]): Promise<void> {
    const cfg = await prisma.onlineTelegram.upsert({ where: { id: 1 }, update: {}, create: { id: 1 } });
    await this.syncToken(cfg);
    if (cfg.testRequestedAt && (!cfg.testDoneAt || cfg.testDoneAt < cfg.testRequestedAt)) await this.sendTest(cfg);
    await this.checkServers(cfg, workers);
  }

  // Бота остановили из панели: перестаём читать сообщения, уведомления не шлём.
  pause(): void {
    this.generation++;
    this.tg = null;
    this.tokenEnc = null;
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

  private async notify(cfg: OnlineTelegram, text: string, what: string): Promise<boolean> {
    if (!this.tg || !cfg.chatIds.length) return true;
    const r = await this.sendAll(cfg, text);
    if (r.temporary) {
      log("warn", `Telegram недоступен: ${what} — отправим позже`);
      return false;
    }
    if (r.errors.length) log("warn", `Telegram: ${what} — дошло не до всех. ${r.errors.join("; ")}`.slice(0, 900));
    if (r.sent) event("telegram.sent", `Telegram: ${what} — отправлено в ${r.sent} из ${cfg.chatIds.length}`);
    return true;
  }

  // Сверяет, что видят воркеры, с тем, что уже сообщили в Telegram.
  private async checkServers(cfg: OnlineTelegram, workers: ServerWorker[]) {
    if (!workers.length) return;
    const rows = await prisma.onlineServerStatus.findMany({
      where: { serverId: { in: workers.map((w) => w.id) } },
      select: { serverId: true, alertState: true, downSince: true },
    });
    const byId = new Map(rows.map((r) => [r.serverId, r]));
    const now = Date.now();

    for (const w of workers) {
      const row = byId.get(w.id);
      if (!row) continue; // воркер ещё не записал статус
      const snap = w.snapshot();
      let data: Prisma.OnlineServerStatusUpdateInput | null = null;

      if (snap.state === "ONLINE") {
        if (row.alertState === "ONLINE") continue;
        // «Снова работает» — только если до этого сообщали (или могли сообщить) о выключении.
        if (row.alertState === "OFFLINE" && row.downSince && cfg.notifyOnline) {
          const downtime = formatDowntime(now - row.downSince.getTime());
          const text = onlineTelegramText(cfg.onlineText, { server: w.name, downtime, players: snap.players, max: snap.max });
          if (!(await this.notify(cfg, text, `«${w.name}» снова работает`))) continue;
        }
        data = { alertState: "ONLINE", downSince: null };
      } else {
        if (row.alertState === "OFFLINE") continue;
        // Короткий обрыв не тревога: ждём, вдруг сервер сейчас же поднимется.
        if (now - snap.offlineSince < cfg.delaySec * 1000) continue;
        if (row.alertState === "ONLINE") {
          if (cfg.notifyOffline) {
            const text = onlineTelegramText(cfg.offlineText, { server: w.name });
            if (!(await this.notify(cfg, text, `«${w.name}» выключился`))) continue;
          }
          data = { alertState: "OFFLINE", downSince: new Date(snap.offlineSince) };
        } else {
          // Сервер ни разу не видели работающим (новый или бот только что запущен): молча запоминаем.
          data = { alertState: "OFFLINE", downSince: null };
        }
      }
      await prisma.onlineServerStatus.update({ where: { serverId: w.id }, data });
    }
  }
}
