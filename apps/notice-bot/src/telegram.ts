import { defaultTemplateId, noticeWipesBetween, prisma, type NoticeKind } from "@flamebot/core";
import { Telegram, TelegramError, type InlineKeyboard, type TgCallback, type TgMessage, type TgUpdate } from "@flamebot/core/telegram";
import { confirmReminder, nextMorning, planText, setAgendaEnabled, testReminder } from "./agenda.js";
import { config } from "./config.js";
import { errorText, log, sleep } from "./events.js";
import * as msg from "./messages.js";
import { editText, sendText, service } from "./service.js";
import { ctx } from "./state.js";

// Интерфейс бота в Telegram: команды и кнопки на карточках вайпа.
// Всё, что здесь можно сделать, можно сделать и в панели: обе стороны вызывают один и тот же сервис.

const COMMANDS = [
  { command: "schedule", description: "Ближайшие вайпы" },
  { command: "plan", description: "План на сегодня" },
  { command: "plan_off", description: "Отключить план дня и напоминания" },
  { command: "plan_on", description: "Включить план дня и напоминания" },
  { command: "test", description: "Тестовый прогон" },
  { command: "remind", description: "Тестовое напоминание" },
  { command: "promos", description: "Промокоды gamestores" },
  { command: "help", description: "Справка" },
];

const STATUS_NOTE: Record<string, string> = {
  sent: "✔️ отправлен",
  partial: "⚠️ отправлен частично",
  skipped: "🚫 отменён",
  missed: "⚠️ пропущен",
};

const zone = (): msg.Zone => ({ tz: ctx().settings.timezone, label: ctx().settings.timezoneLabel });
const who = (u: { first_name?: string; username?: string; id: number }) => (u.username ? `@${u.username}` : (u.first_name ?? String(u.id)));

export class TelegramUi {
  private offset = 0;
  private stopped = false;

  constructor(private readonly t: Telegram) {}

  stop(): void {
    this.stopped = true;
  }

  // Меню команд видно только админам (остальным меню пустое).
  async setupMenu(): Promise<void> {
    await this.t.deleteMyCommands({ type: "default" }).catch(() => undefined);
    for (const chat of ctx().adminIds) {
      try {
        await this.t.setMyCommands(COMMANDS, { type: "chat", chat_id: chat });
        await this.t.setChatMenuButton(chat).catch(() => undefined);
      } catch (err) {
        log.info(`Меню команд для ${chat} не установлено (админ ещё не нажимал /start?): ${errorText(err)}`);
      }
    }
  }

  async run(): Promise<void> {
    while (!this.stopped) {
      let updates: TgUpdate[];
      try {
        updates = await this.t.getUpdates(this.offset);
      } catch (err) {
        if (this.stopped) return;
        if (err instanceof TelegramError && err.code === 409) {
          log.error("Этот токен Telegram уже опрашивает другой бот. Если прежний бот на Python ещё запущен, останови его.");
          await sleep(30_000);
        } else if (err instanceof TelegramError && err.code === 401) {
          log.error("Telegram не принял токен бота: замени его в панели («Подключение»)");
          await sleep(60_000);
        } else {
          log.info(`Telegram: ${errorText(err)}, повтор через 5 с`);
          await sleep(5_000);
        }
        continue;
      }
      for (const u of updates) {
        this.offset = Math.max(this.offset, u.update_id + 1);
        if (this.stopped) return;
        void this.handle(u).catch((err) => log.error("Ошибка обработки сообщения Telegram", err));
      }
    }
  }

  private isAdmin(id: number | undefined): boolean {
    return id !== undefined && ctx().adminIds.includes(String(id));
  }

  private async handle(u: TgUpdate): Promise<void> {
    if (u.callback_query) {
      if (this.isAdmin(u.callback_query.from.id)) await this.onCallback(u.callback_query);
    } else if (u.message) {
      if (this.isAdmin(u.message.from?.id)) await this.onMessage(u.message);
    }
  }

  private reply(m: TgMessage, text: string, kb?: InlineKeyboard | null) {
    return sendText(m.chat.id, text, kb);
  }

  private answer(c: TgCallback, text?: string, alert = false) {
    return this.t.answerCallback(c.id, text, alert).catch(() => undefined);
  }

  private async edit(c: TgCallback, text: string | null, kb: InlineKeyboard | null): Promise<void> {
    if (!c.message) return;
    if (text === null) await this.t.editMessageReplyMarkup(c.message.chat.id, c.message.message_id, kb).catch(() => undefined);
    else await editText(c.message.chat.id, c.message.message_id, text, kb).catch((err) => log.info(`Правка сообщения: ${errorText(err)}`));
  }

  // ---------------------------------------------------------------- команды

  private async onMessage(m: TgMessage): Promise<void> {
    const text = (m.text ?? "").trim();
    if (!text.startsWith("/")) return;
    const [head, ...rest] = text.slice(1).split(/\s+/);
    const command = head!.split("@")[0]!.toLowerCase();
    const arg = rest.join(" ").trim();
    const by = who(m.from!);

    switch (command) {
      case "start":
      case "help":
        await this.reply(m, msg.helpText(ctx().settings.notifyMinutes, config.PANEL_URL ? `${config.PANEL_URL}/notices` : null));
        return;
      case "schedule":
        await this.reply(m, await this.scheduleText());
        return;
      case "plan":
        await this.reply(m, ctx().agenda.size ? await planText(arg, new Date()) : "📋 Плана дня нет: он заполняется в панели.");
        return;
      case "plan_off":
        await this.reply(m, msg.agendaOff(!(await setAgendaEnabled(false, by))));
        return;
      case "plan_on": {
        const changed = await setAgendaEnabled(true, by);
        await this.reply(m, msg.agendaOn(nextMorning(new Date()), zone(), !changed));
        return;
      }
      case "remind": {
        const r = await testReminder(arg || null);
        if (!r.ok) await this.reply(m, `⚠️ ${msg.e(r.text)}`);
        return;
      }
      case "promos":
        await this.reply(m, await this.promosText());
        return;
      case "test": {
        const args = arg.split(/\s+/).filter(Boolean);
        if (!args.length) {
          await this.reply(m, msg.testMenu(this.testModeLines()), msg.testKb());
          return;
        }
        const kind = args[0]!.toLowerCase();
        const minutes = args[1] === undefined ? 2 : Number(args[1]);
        if ((kind !== "regular" && kind !== "global") || !Number.isInteger(minutes) || minutes < 1 || minutes > 1440) {
          await this.reply(m, msg.testUsage());
          return;
        }
        const r = await service.startTest(kind, minutes);
        if (!r.ok) await this.reply(m, `⚠️ ${msg.e(r.text)}`);
        return;
      }
    }
  }

  async scheduleText(): Promise<string> {
    const c = ctx();
    const now = new Date();
    const wipes = noticeWipesBetween(c.rules, c.settings.timezone, now, new Date(now.getTime() + 30 * 86_400_000)).slice(0, 10);
    const events = new Map((await prisma.noticeEvent.findMany({ where: { key: { in: wipes.map((w) => w.key) } } })).map((ev) => [ev.key, ev]));
    const rows = wipes.map((w) => {
      const ev = events.get(w.key);
      const tplId = ev?.templateId ?? defaultTemplateId(w.rule, w.kind);
      const tpl = tplId ? c.templates.get(tplId) : undefined;
      const note = ev && ev.status !== "pending" ? (STATUS_NOTE[ev.status] ?? "") : ev?.confirmed ? "✅ подтверждён" : "";
      return { wipeAt: w.wipeAt, kind: (tpl?.kind ?? w.kind) as NoticeKind, note, promo: tpl?.promoAmount ?? null };
    });
    return msg.scheduleText(rows, zone());
  }

  testModeLines(): string[] {
    const c = ctx();
    const dry = c.settings.dryRun;
    const place = (real: boolean, text: string) => (real && !dry ? `✅ ${text}` : "🧪 пробный прогон (ничего не отправляется)");
    return [
      `<b>Discord</b> — ${place(!!c.test.discord, "тестовый канал")}`,
      `<b>ВКонтакте</b> — ${place(!!(c.test.vkToken && c.test.vkGroupId), "тестовое сообщество")}`,
      `<b>Промокод</b> — ${place(!!c.gamestores && c.settings.promoTestReal, "тестовый TEST-… со скидкой 1%")}`,
    ];
  }

  private async promosText(): Promise<string> {
    try {
      const list = await service.promos();
      return list ? msg.promosOk(list) : msg.promosNotConfigured();
    } catch (err) {
      return msg.promosError(errorText(err));
    }
  }

  // ---------------------------------------------------------------- кнопки

  private async onCallback(c: TgCallback): Promise<void> {
    const [action, a1 = "", a2 = ""] = (c.data ?? "").split("|");
    const by = who(c.from);
    const stale = async () => {
      await this.answer(c, msg.STALE, true);
      await this.edit(c, null, null);
    };
    const pending = async (key: string) => {
      const ev = await prisma.noticeEvent.findUnique({ where: { key } });
      return ev && ev.status === "pending" ? ev : null;
    };

    switch (action) {
      case "ok": {
        const r = await service.confirm(a1, by);
        if (r.text === msg.STALE) return stale();
        await this.answer(c, r.ok ? "Подтверждено" : "Промокод не создан", !r.ok);
        return;
      }
      case "chg": {
        const ev = await pending(a1);
        if (!ev) return stale();
        const { text } = service.compose(ev, msg.hPick());
        await this.edit(c, text, msg.templatesKb(ev, [...ctx().templates.values()]));
        await this.answer(c, "Выберите текст");
        return;
      }
      case "tpl": {
        const r = await service.pickTemplate(a1, a2, by);
        if (r.text === msg.STALE) return stale();
        await this.answer(c, r.ok ? "Текст изменён" : r.text, !r.ok);
        return;
      }
      case "back": {
        const ev = await pending(a1);
        if (!ev) return stale();
        const { text, kb } = service.compose(ev, service.defaultHeader(ev));
        await this.edit(c, text, kb);
        await this.answer(c);
        return;
      }
      case "skip": {
        const ev = await pending(a1);
        if (!ev) return stale();
        const { text } = service.compose(ev, msg.hSkip());
        await this.edit(c, text, msg.skipConfirmKb(ev));
        await this.answer(c, "Точно не отправлять?");
        return;
      }
      case "skipyes": {
        const r = await service.skip(a1, by);
        if (r.text === msg.STALE) return stale();
        await this.answer(c, "Отправка отменена");
        return;
      }
      case "retry": {
        await this.answer(c, "Повторяю");
        const r = await service.retry(a1);
        if (r.text === msg.STALE) await this.edit(c, null, null);
        return;
      }
      case "test": {
        await this.answer(c, "Запускаю тест");
        await this.edit(c, null, null);
        const r = await service.startTest(a1 === "global" ? "global" : "regular", 2);
        if (!r.ok && c.message) await sendText(c.message.chat.id, `⚠️ ${msg.e(r.text)}`);
        return;
      }
      case "agenda": {
        const changed = await setAgendaEnabled(false, by);
        await this.edit(c, null, null);
        await this.answer(c, "Уведомления отключены");
        if (c.message) await sendText(c.message.chat.id, msg.agendaOff(!changed));
        return;
      }
      case "rm": {
        const { rem, already } = await confirmReminder(a1, a2, by);
        if (!rem) {
          await this.answer(c, "Это напоминание больше не настроено", true);
          await this.edit(c, null, null);
          return;
        }
        await this.answer(c, already ? "Уже отмечено" : "Отмечено");
        return;
      }
      default:
        await this.answer(c);
    }
  }
}

