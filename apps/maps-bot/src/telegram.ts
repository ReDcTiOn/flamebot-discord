import { mkdir, unlink } from "node:fs/promises";
import { join } from "node:path";
import { BOT_API_FILE_LIMIT, Telegram, TelegramError, type InlineKeyboard, type Markup, type TgCallback, type TgMessage, type TgUpdate } from "./clients/telegram.js";
import { config } from "./config.js";
import { errorText, log, sleep } from "./events.js";
import { downloadUrl, sanitizeFilename } from "./files.js";
import * as msg from "./messages.js";
import { service, tmpDir } from "./service.js";
import { ctx } from "./state.js";

// Интерфейс бота в Telegram: команды, кнопки на карточках и диалог загрузки своей карты.
// Всё, что здесь можно сделать, можно сделать и в панели: обе стороны вызывают один и тот же сервис.

const COMMANDS = [
  { command: "start", description: "Показать команды и кнопки" },
  { command: "next", description: "Ближайшие вайпы и расписание" },
  { command: "status", description: "Состояние карт и пула" },
  { command: "gen", description: "Начать генерацию на вайп заранее" },
  { command: "reset", description: "Изменить карты вайпа (снять подтверждения или заменить все)" },
  { command: "upload", description: "Добавить карту вручную" },
  { command: "discord", description: "Вернуть вопрос про отправку в Discord" },
  { command: "resend", description: "Отправить анонс в Discord повторно" },
  { command: "panel", description: "Что записано в задачах вайпа на панели" },
  { command: "global", description: "Глобальный или обычный вайп (Wipe Blueprints)" },
  { command: "auto", description: "Автоподбор карт: включить или выключить" },
  { command: "cancel", description: "Отменить добавление карты" },
];

const URL_RE = /https?:\/\/\S+/g;
const panelLink = () => (config.PANEL_URL ? `${config.PANEL_URL}/maps` : null);

// Диалог ручной загрузки: ждём файл или ссылку (source), затем ссылку на страницу карты (view).
interface UploadState {
  step: "source" | "view";
  slotId: number;
  path?: string;
  filename?: string | null;
}

export class TelegramUi {
  private offset = 0;
  private stopped = false;
  private states = new Map<number, UploadState>();

  constructor(private readonly t: Telegram) {}

  stop(): void {
    this.stopped = true;
  }

  // Кнопка «Меню» со списком команд, видимая только админам (остальным меню пустое).
  async setupMenu(): Promise<void> {
    const { adminIds, chatId } = ctx();
    await this.t.deleteMyCommands({ type: "default" }).catch((err) => log.info(`Не удалось очистить общее меню команд: ${errorText(err)}`));
    for (const chat of new Set([...adminIds, ...(chatId ? [chatId] : [])])) {
      try {
        await this.t.setMyCommands(COMMANDS, { type: "chat", chat_id: chat });
      } catch (err) {
        log.info(`Меню команд для чата ${chat} не установлено (админ ещё не нажимал /start?): ${errorText(err)}`);
        continue;
      }
      await this.t.setChatMenuButton(chat).catch(() => undefined); // кнопка меню настраивается только для личных чатов
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
          log.error("Этот токен Telegram уже опрашивает другой бот. Если старый бот на Python ещё запущен, останови его.");
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
        // Обработчики не ждём: долгая загрузка карты не должна задерживать остальные кнопки.
        void this.handle(u).catch((err) => log.error("Ошибка обработки сообщения Telegram", err));
      }
    }
  }

  private isAdmin(userId: number | undefined): boolean {
    return userId !== undefined && ctx().adminIds.has(String(userId));
  }

  private async handle(u: TgUpdate): Promise<void> {
    if (u.callback_query) {
      if (!this.isAdmin(u.callback_query.from.id)) return;
      await this.onCallback(u.callback_query);
    } else if (u.message) {
      if (!this.isAdmin(u.message.from?.id)) return;
      await this.onMessage(u.message);
    }
  }

  // ---------------------------------------------------------------- ответы
  private reply(m: TgMessage, text: string, markup?: Markup | null) {
    return this.t.sendMessage(m.chat.id, text, markup);
  }

  private async editCb(c: TgCallback, text: string, markup: InlineKeyboard | null = null): Promise<void> {
    if (!c.message) return;
    await this.t.editMessageText(c.message.chat.id, c.message.message_id, text, markup).catch((err) => log.info(`Правка сообщения: ${errorText(err)}`));
  }

  private answer(c: TgCallback, text?: string, alert = false) {
    return this.t.answerCallback(c.id, text, alert).catch(() => undefined);
  }

  // ---------------------------------------------------------------- диалог загрузки
  private async dropState(userId: number): Promise<void> {
    const st = this.states.get(userId);
    this.states.delete(userId);
    if (st?.path) await unlink(st.path).catch(() => undefined);
  }

  private async finish(m: TgMessage, userId: number, viewUrl: string | null): Promise<void> {
    const st = this.states.get(userId);
    this.states.delete(userId);
    if (!st?.path) return;
    const note = await this.reply(m, msg.uploadProgress());
    try {
      await service.manualUpload(st.slotId, st.path, viewUrl, st.filename ?? null);
      await this.t.editMessageText(m.chat.id, note.message_id, msg.uploadDone());
    } catch (err) {
      await this.t.editMessageText(m.chat.id, note.message_id, msg.uploadFailed(errorText(err))).catch(() => undefined);
    } finally {
      await unlink(st.path).catch(() => undefined);
    }
  }

  private async gotFile(m: TgMessage, userId: number, path: string, viewUrl: string | null, filename: string | null): Promise<void> {
    const st = this.states.get(userId);
    if (!st) return;
    if (st.path) await unlink(st.path).catch(() => undefined);
    st.path = path;
    st.filename = filename;
    if (viewUrl) return this.finish(m, userId, viewUrl);
    st.step = "view";
    await this.reply(m, msg.uploadAskView(), msg.kbSkipView());
  }

  private async newTmpPath(): Promise<string> {
    await mkdir(tmpDir(), { recursive: true });
    return join(tmpDir(), `manual_${Date.now()}_${Math.random().toString(36).slice(2)}.map`);
  }

  // ---------------------------------------------------------------- сообщения
  private async onMessage(m: TgMessage): Promise<void> {
    const userId = m.from!.id;
    const text = (m.text ?? "").trim();
    const command = text.startsWith("/") ? text.slice(1).split(/[\s@]/)[0]!.toLowerCase() : null;
    const st = this.states.get(userId);

    if (command === "start" || command === "help") {
      await this.dropState(userId);
      await this.reply(m, msg.helpText(panelLink()), msg.kbMainReply());
      return;
    }
    if (command === "cancel") {
      await this.dropState(userId);
      await this.reply(m, msg.cancelled());
      return;
    }

    // Диалог загрузки: ждём файл или ссылку.
    if (st && !command && text !== msg.BTN_ADD && text !== msg.BTN_RESET) {
      if (st.step === "source") return this.onSource(m, userId);
      const urls = text.match(URL_RE) ?? [];
      if (!urls.length) {
        await this.reply(m, msg.uploadViewNoLink(), msg.kbSkipView());
        return;
      }
      return this.finish(m, userId, urls[0]!);
    }

    switch (command ?? (text === msg.BTN_RESET ? "reset" : text === msg.BTN_ADD ? "upload" : null)) {
      case "next":
        await this.reply(m, service.nextText());
        return;
      case "status":
        await this.reply(m, await service.statusText());
        return;
      case "gen": {
        const targets = await service.genableWipes();
        await this.reply(m, targets.length ? msg.genPick() : msg.genNone(), targets.length ? msg.kbPick(targets, "gn") : null);
        return;
      }
      case "reset": {
        await this.dropState(userId);
        const targets = await service.resetTargets();
        await this.reply(m, targets.length ? msg.resetPick() : msg.resetNone(), targets.length ? msg.kbPick(targets, "rs") : null);
        return;
      }
      case "discord": {
        const result = await service.repromptDiscord();
        if (result === "Нечего отправлять") await this.reply(m, msg.actionResult("📨", result));
        return;
      }
      case "auto": {
        const on = service.autoEnabled();
        await this.reply(m, msg.autoMenu(on), msg.kbAutoMenu(on, await service.autoTargets()));
        return;
      }
      case "global": {
        const targets = await service.globalTargets();
        await this.reply(m, targets.length ? msg.globalMenu() : msg.globalNone(), targets.length ? msg.kbGlobalList(targets) : null);
        return;
      }
      case "panel":
        await this.reply(m, await service.panelText(), msg.kbPanelNow(await service.panelTargets()));
        return;
      case "resend": {
        const targets = await service.resendTargets();
        await this.reply(m, targets.length ? msg.resendPick() : msg.resendNone(), targets.length ? msg.kbPick(targets, "rd") : null);
        return;
      }
      case "upload": {
        await this.dropState(userId);
        const targets = await service.manualTargets();
        await this.reply(m, targets.length ? msg.uploadPick() : msg.uploadNone(), targets.length ? msg.kbPick(targets, "mu") : null);
        return;
      }
    }
  }

  private async onSource(m: TgMessage, userId: number): Promise<void> {
    if (m.document) {
      if ((m.document.file_size ?? 0) > BOT_API_FILE_LIMIT) {
        await this.reply(m, msg.uploadTooBig());
        return;
      }
      const path = await this.newTmpPath();
      await this.t.downloadFile(m.document.file_id, path);
      const found = (m.caption ?? "").match(URL_RE) ?? [];
      return this.gotFile(m, userId, path, found[0] ?? null, sanitizeFilename(m.document.file_name));
    }
    const urls = (m.text ?? "").match(URL_RE) ?? [];
    if (!urls.length) {
      await this.reply(m, msg.uploadNoLink());
      return;
    }
    const note = await this.reply(m, msg.uploadDownloading());
    const path = await this.newTmpPath();
    let filename: string | null;
    try {
      filename = (await downloadUrl(urls[0]!, path)).filename;
    } catch (err) {
      await this.t.editMessageText(m.chat.id, note.message_id, msg.uploadDownloadFailed(errorText(err)));
      return;
    }
    await this.t.deleteMessage(m.chat.id, note.message_id).catch(() => undefined);
    return this.gotFile(m, userId, path, urls[1] ?? null, filename);
  }

  // ---------------------------------------------------------------- кнопки
  private async onCallback(c: TgCallback): Promise<void> {
    const data = c.data ?? "";
    const [prefix, ...rest] = data.split(":");
    const arg = rest.join(":");
    const num = Number(arg);

    switch (prefix) {
      case "gn": {
        const result = await service.startWipe(arg);
        await this.answer(c, result);
        return this.editCb(c, msg.actionResult("🚀", result));
      }
      case "rs":
        await this.editCb(c, await service.resetSummary(arg), msg.kbResetMenu(arg));
        return void (await this.answer(c));
      case "ru": {
        const result = await service.unconfirm(arg);
        await this.answer(c, result);
        return this.editCb(c, msg.actionResult("↩", result));
      }
      case "rn":
        await this.editCb(c, msg.resetReplaceConfirm(), msg.kbReplaceConfirm(arg));
        return void (await this.answer(c));
      case "rnc": {
        const result = await service.replaceAll(arg);
        await this.answer(c, result);
        return this.editCb(c, msg.actionResult("🔄", result));
      }
      case "at": {
        const on = await service.toggleAuto();
        await this.answer(c, on ? "Автоподбор включён" : "Автоподбор выключен");
        return this.editCb(c, msg.autoMenu(on), msg.kbAutoMenu(on, await service.autoTargets()));
      }
      case "au":
        return void (await this.answer(c, await service.autoStart(arg)));
      case "ac":
        return void (await this.answer(c, await service.autoConfirm(arg)));
      case "ar":
        return void (await this.answer(c, await service.autoReroll(arg)));
      case "am":
        return void (await this.answer(c, await service.autoManual(arg)));
      case "gb": {
        const result = await service.toggleGlobal(arg);
        await this.answer(c, result, true);
        if (c.message) await this.t.editMessageReplyMarkup(c.message.chat.id, c.message.message_id, msg.kbGlobalList(await service.globalTargets())).catch(() => undefined);
        return;
      }
      case "pn": {
        const [action, cycleId] = [rest[0], rest.slice(1).join(":")];
        if (action === "ok") {
          await this.answer(c, "Обновляю ссылки…"); // запись занимает несколько секунд, итог придёт в сообщение
          await service.panelApply(cycleId, c.message?.message_id ?? null);
        } else await this.answer(c, await service.panelSkip(cycleId));
        return;
      }
      case "rd":
        await this.editCb(c, await service.resendSummary(arg), msg.kbResendConfirm(arg));
        return void (await this.answer(c));
      case "rdc": {
        const [ok, detail] = await service.resendDiscord(arg);
        await this.answer(c, ok ? "Отправлено" : "Не отправилось");
        return this.editCb(c, ok ? msg.resendDone(detail) : msg.discordFailed(detail));
      }
      case "mu": {
        const label = await service.manualTargetLabel(num);
        if (!label) return void (await this.answer(c, "Сюда карту уже нельзя добавить", true));
        await this.dropState(c.from.id);
        this.states.set(c.from.id, { step: "source", slotId: num });
        if (c.message) await this.t.sendMessage(c.message.chat.id, msg.uploadPrompt(label), msg.kbCancel());
        return void (await this.answer(c));
      }
      case "mv": {
        await this.answer(c);
        const st = this.states.get(c.from.id);
        if (st?.step === "view" && c.message) await this.finish(c.message, c.from.id, null);
        return;
      }
      case "mc":
        await this.dropState(c.from.id);
        await this.answer(c, "Отменено");
        if (c.message) await this.t.editMessageReplyMarkup(c.message.chat.id, c.message.message_id, null).catch(() => undefined);
        return;
      case "ap":
        return void (await this.answer(c, await service.approve(num)));
      case "bk":
        return void (await this.answer(c, await service.goBack(num)));
      case "rr":
        return void (await this.answer(c, await service.reroll(num)));
      case "dc": {
        const [action, cycleId] = [rest[0], rest.slice(1).join(":")];
        const result = action === "now" ? await service.sendDiscord(cycleId) : action === "no" ? await service.skipDiscord(cycleId) : "Эта кнопка устарела";
        return void (await this.answer(c, result));
      }
      default:
        return void (await this.answer(c, "Эта кнопка устарела"));
    }
  }
}
