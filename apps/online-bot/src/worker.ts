import { ActivityType, Client, Events, GatewayIntentBits, type PresenceStatusData } from "discord.js";
import { onlineStatusText, prisma, type OnlineServer, type OnlineSettings, type OnlineState } from "@flamebot/core";
import { event, log } from "./events.js";
import { WebRcon, type RconMessage } from "./rcon.js";

const PRESENCE_REFRESH_MS = 10 * 60_000;
// Изменения онлайна пишем в базу не чаще раза в 5 секунд, смена состояния — сразу.
const STATUS_WRITE_MIN_MS = 5_000;

type Presence = { status: PresenceStatusData; text: string };

// Один игровой сервер: RCON-опрос serverinfo и Discord-бот, который показывает онлайн в статусе.
// Логика повторяет исходный бот: подключение → «запускается» → «онлайн N/M»,
// при обрыве или тишине дольше responseTimeout — «выключен» и переподключение.
export class ServerWorker {
  private bot: Client | null = null;
  private rcon: WebRcon | null = null;
  private pollTimer: NodeJS.Timeout | null = null;
  private connectTimer: NodeJS.Timeout | null = null;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private presenceTimer: NodeJS.Timeout | null = null;
  private lastResponseAt = 0;
  private lastFailReason = "";
  private stopped = false;

  private presence: Presence;
  private appliedPresence = "";

  private state: OnlineState = "OFFLINE";
  private everOnline = false;
  private info = { players: 0, max: 0, queued: 0 };
  private botTag: string | null = null;
  private botError: string | null = null;
  private rconError: string | null = null;
  private lastStatusWrite = 0;
  private statusTimer: NodeJS.Timeout | null = null;

  constructor(
    private readonly server: OnlineServer,
    private readonly secrets: { rconPassword: string | null; discordToken: string | null },
    private readonly settings: OnlineSettings,
    private readonly allowPrivate: boolean,
  ) {
    this.presence = { status: "dnd", text: settings.offlineText };
  }

  private get label() {
    return `«${this.server.name}» (${this.server.host}:${this.server.port})`;
  }

  start(): void {
    if (this.secrets.discordToken) this.startDiscord(this.secrets.discordToken);
    else this.botError = "Токен Discord не задан";
    if (this.secrets.rconPassword) this.connect();
    else this.rconError = "Пароль RCON не задан";
    void this.writeStatus(true);
  }

  async stop(): Promise<void> {
    this.stopped = true;
    this.closeRcon();
    for (const t of [this.reconnectTimer, this.presenceTimer, this.statusTimer]) if (t) clearTimeout(t);
    if (this.bot) await this.bot.destroy().catch(() => undefined);
    this.bot = null;
  }

  // ---------- Discord ----------

  private startDiscord(token: string) {
    const bot = new Client({ intents: [GatewayIntentBits.Guilds] });
    this.bot = bot;

    bot.once(Events.ClientReady, (c) => {
      this.botTag = c.user.tag;
      this.botError = null;
      log("info", `${this.label}: бот вошёл как ${c.user.tag}`);
      this.applyPresence(true);
      this.presenceTimer = setInterval(() => this.applyPresence(true), PRESENCE_REFRESH_MS);
      void this.writeStatus(true);
    });
    // После переподключения к Discord статус сбрасывается — отправляем заново.
    bot.on(Events.ShardReady, () => this.applyPresence(true));
    bot.on(Events.ShardResume, () => this.applyPresence(true));
    bot.on(Events.Error, (err) => log("warn", `${this.label}: ошибка Discord`, err));

    const login = () => {
      if (this.stopped) return;
      bot.login(token).catch((err: Error & { code?: string }) => {
        this.botError = err.code === "TokenInvalid" ? "Токен Discord недействителен" : `Не удалось войти в Discord: ${err.message}`;
        log("error", `${this.label}: ${this.botError}`);
        void this.writeStatus(true);
        if (err.code !== "TokenInvalid" && !this.stopped) setTimeout(login, 30_000);
      });
    };
    login();
  }

  private setPresence(status: PresenceStatusData, text: string) {
    this.presence = { status, text };
    this.applyPresence(false);
  }

  private applyPresence(force: boolean) {
    if (!this.bot?.isReady()) return;
    const key = `${this.presence.status}|${this.presence.text}`;
    if (!force && key === this.appliedPresence) return;
    try {
      this.bot.user.setPresence({ activities: [{ name: this.presence.text, type: ActivityType.Custom }], status: this.presence.status });
      this.appliedPresence = key;
    } catch (err) {
      log("warn", `${this.label}: не удалось обновить статус`, err);
    }
  }

  // ---------- Состояние сервера ----------

  private setState(state: OnlineState, reason?: string) {
    const prev = this.state;
    this.state = state;
    if (state === "OFFLINE") this.setPresence("dnd", this.settings.offlineText);
    if (state === "STARTING") this.setPresence("idle", this.settings.startingText);
    if (prev === state) return;

    if (state === "ONLINE") {
      event("server.online", `${this.label}: сервер онлайн`, { details: { ...this.info } });
      this.everOnline = true;
    } else if (state === "STARTING") {
      event("server.starting", `${this.label}: RCON подключён, сервер запускается`);
    } else if (state === "OFFLINE" && this.everOnline) {
      event("server.offline", `${this.label}: сервер недоступен${reason ? ` — ${reason}` : ""}`, { level: "WARN" });
    }
    void this.writeStatus(true);
  }

  // Записи статуса идут строго по очереди: иначе более старая могла бы затереть свежую.
  private writing: Promise<void> = Promise.resolve();

  private writeStatus(force: boolean): Promise<void> {
    const now = Date.now();
    if (!force && now - this.lastStatusWrite < STATUS_WRITE_MIN_MS) {
      if (!this.statusTimer) {
        this.statusTimer = setTimeout(() => {
          this.statusTimer = null;
          void this.writeStatus(true);
        }, STATUS_WRITE_MIN_MS);
      }
      return this.writing;
    }
    this.lastStatusWrite = now;
    this.writing = this.writing.then(() => this.persistStatus());
    return this.writing;
  }

  private async persistStatus() {
    if (this.stopped) return;
    // Данные берём в момент записи, а не в момент вызова — всегда самое свежее состояние.
    const data = {
      state: this.state,
      players: this.state === "ONLINE" ? this.info.players : null,
      maxPlayers: this.state === "ONLINE" ? this.info.max : null,
      queued: this.state === "ONLINE" ? this.info.queued : null,
      botTag: this.botTag,
      botError: this.botError,
      rconError: this.rconError,
      ...(this.state !== "OFFLINE" ? { lastSeenAt: new Date(this.lastResponseAt || Date.now()) } : {}),
    };
    try {
      await prisma.onlineServerStatus.upsert({ where: { serverId: this.server.id }, create: { serverId: this.server.id, ...data }, update: data });
    } catch (err) {
      log("warn", `${this.label}: не удалось записать статус`, err);
    }
  }

  // ---------- RCON ----------

  private connect() {
    this.reconnectTimer = null;
    if (this.stopped) return;
    this.closeRcon();

    const current = new WebRcon(this.server.host, this.server.port, this.allowPrivate);
    this.rcon = current;
    // События от старых соединений игнорируем, иначе они ломают состояние текущего.
    const isCurrent = () => this.rcon === current;

    current.on("connect", () => {
      if (!isCurrent()) return;
      if (this.connectTimer) clearTimeout(this.connectTimer);
      this.lastFailReason = "";
      this.rconError = null;
      this.lastResponseAt = Date.now();
      // При подключении сервер ещё может грузиться.
      this.setState("STARTING");
      this.pollTimer = setInterval(() => this.poll(), this.settings.pollIntervalMs);
      this.poll();
    });

    current.on("message", (msg: RconMessage) => {
      if (!isCurrent()) return;
      this.lastResponseAt = Date.now();
      let data: { Players?: number; MaxPlayers?: number; Queued?: number } | null = null;
      try {
        data = JSON.parse(msg.Message);
      } catch {
        return; // обычная строка лога, не serverinfo
      }
      if (!data || typeof data.Players !== "number") return;
      this.info = { players: data.Players, max: data.MaxPlayers ?? 0, queued: data.Queued ?? 0 };
      const text = onlineStatusText(this.info.queued > 0 ? this.settings.queueText : this.settings.onlineText, this.info);
      this.setPresence("online", text);
      if (this.state !== "ONLINE") this.setState("ONLINE");
      else void this.writeStatus(false);
    });

    current.on("disconnect", () => {
      if (isCurrent()) this.connectionLost("соединение закрыто");
    });
    current.on("error", (err: Error) => {
      if (!isCurrent()) return;
      // Неудачное подключение даёт только error, без disconnect.
      if (!current.connected) this.connectionLost(err?.message || "ошибка подключения");
      else log("warn", `${this.label}: ошибка RCON`, err);
    });

    this.connectTimer = setTimeout(() => {
      if (isCurrent() && !current.connected) this.connectionLost("не дождались подключения");
    }, this.settings.connectTimeoutMs);

    current.connect(this.secrets.rconPassword!).catch((err: Error) => this.connectionLost(err.message));
  }

  private poll() {
    if (!this.rcon) return;
    // Соединение может «зависнуть» без закрытия (обрыв сети, DDoS) — переподключаемся.
    if (Date.now() - this.lastResponseAt > this.settings.responseTimeoutMs) {
      this.connectionLost(`нет ответа ${Math.round(this.settings.responseTimeoutMs / 1000)} с`);
      return;
    }
    try {
      this.rcon.run("serverinfo", 0);
    } catch (err) {
      this.connectionLost(`не удалось отправить запрос: ${(err as Error).message}`);
    }
  }

  private connectionLost(reason: string) {
    if (this.stopped) return;
    if (reason !== this.lastFailReason) {
      log("info", `${this.label}: сервер недоступен (${reason}), переподключение`);
      this.lastFailReason = reason;
      this.rconError = reason;
    }
    this.setState("OFFLINE", reason);
    this.closeRcon();
    if (!this.reconnectTimer) this.reconnectTimer = setTimeout(() => this.connect(), this.settings.pollIntervalMs);
  }

  private closeRcon() {
    if (this.pollTimer) clearInterval(this.pollTimer);
    if (this.connectTimer) clearTimeout(this.connectTimer);
    this.pollTimer = this.connectTimer = null;
    if (!this.rcon) return;
    const old = this.rcon;
    this.rcon = null;
    old.close();
  }
}
