import { createWriteStream } from "node:fs";
import { unlink } from "node:fs/promises";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

// Минимальный клиент Telegram Bot API на fetch. Токен входит только в адрес запроса
// и никогда не попадает в тексты ошибок.

export type InlineButton = { text: string; callback_data?: string; url?: string };
export type InlineKeyboard = { inline_keyboard: InlineButton[][] };
export type ReplyKeyboard = { keyboard: { text: string }[][]; resize_keyboard?: boolean; is_persistent?: boolean };
export type Markup = InlineKeyboard | ReplyKeyboard;

export interface TgUser {
  id: number;
  username?: string;
  first_name?: string;
}
export interface TgMessage {
  message_id: number;
  chat: { id: number; type: string };
  from?: TgUser;
  text?: string;
  caption?: string;
  document?: { file_id: string; file_name?: string; file_size?: number };
}
export interface TgCallback {
  id: string;
  from: TgUser;
  data?: string;
  message?: TgMessage;
}
export interface TgUpdate {
  update_id: number;
  message?: TgMessage;
  channel_post?: TgMessage;
  callback_query?: TgCallback;
}

// Окончательная ошибка: Telegram ответил, но не принял запрос (400, 403...).
export class TelegramError extends Error {
  constructor(
    readonly code: number,
    readonly description: string,
    readonly retryAfter: number | null = null,
  ) {
    super(`Telegram ${code}: ${description}`);
  }
}

// Временная ошибка: сеть, 5xx. Её стоит повторить.
export class TelegramNetworkError extends Error {}

export const BOT_API_FILE_LIMIT = 20 * 1024 * 1024; // бот не может скачать из Telegram файл больше 20 МБ

export class Telegram {
  constructor(private readonly token: string) {}

  async call<T>(method: string, params: Record<string, unknown> | FormData = {}, timeoutMs = 30_000): Promise<T> {
    let res: Response;
    try {
      res = await fetch(`https://api.telegram.org/bot${this.token}/${method}`, {
        method: "POST",
        ...(params instanceof FormData
          ? { body: params }
          : { body: JSON.stringify(params), headers: { "Content-Type": "application/json" } }),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (err) {
      const why = err instanceof Error && err.name === "TimeoutError" ? "истекло время ожидания" : "нет связи";
      throw new TelegramNetworkError(`Telegram недоступен: ${why}`);
    }
    if (res.status >= 500) {
      await res.body?.cancel();
      throw new TelegramNetworkError(`Telegram недоступен: ответ ${res.status}`);
    }
    const body = (await res.json().catch(() => null)) as {
      ok?: boolean;
      result?: T;
      error_code?: number;
      description?: string;
      parameters?: { retry_after?: number };
    } | null;
    if (body?.ok) return body.result as T;
    throw new TelegramError(body?.error_code ?? res.status, body?.description ?? "неизвестная ошибка", body?.parameters?.retry_after ?? null);
  }

  getMe() {
    return this.call<TgUser & { is_bot: boolean }>("getMe");
  }

  getUpdates(offset: number, timeoutSec = 50, allowed: string[] = ["message", "callback_query"]) {
    return this.call<TgUpdate[]>("getUpdates", { offset, timeout: timeoutSec, allowed_updates: allowed }, (timeoutSec + 15) * 1000);
  }

  sendMessage(chatId: string | number, text: string, markup?: Markup | null, html = true) {
    return this.call<TgMessage>("sendMessage", {
      chat_id: chatId,
      text,
      ...(html ? { parse_mode: "HTML" } : {}),
      link_preview_options: { is_disabled: true },
      ...(markup ? { reply_markup: markup } : {}),
    });
  }

  editMessageText(chatId: string | number, messageId: number, text: string, markup?: InlineKeyboard | null, html = true) {
    return this.call<unknown>("editMessageText", {
      chat_id: chatId,
      message_id: messageId,
      text,
      ...(html ? { parse_mode: "HTML" } : {}),
      link_preview_options: { is_disabled: true },
      // Пустая клавиатура убирает кнопки у сообщения.
      reply_markup: markup ?? { inline_keyboard: [] },
    });
  }

  editMessageReplyMarkup(chatId: string | number, messageId: number, markup: InlineKeyboard | null) {
    return this.call<unknown>("editMessageReplyMarkup", { chat_id: chatId, message_id: messageId, reply_markup: markup ?? { inline_keyboard: [] } });
  }

  deleteMessage(chatId: string | number, messageId: number) {
    return this.call<boolean>("deleteMessage", { chat_id: chatId, message_id: messageId });
  }

  sendPhoto(chatId: string | number, image: Buffer, caption: string) {
    const fd = new FormData();
    fd.set("chat_id", String(chatId));
    fd.set("caption", caption);
    fd.set("parse_mode", "HTML");
    fd.set("photo", new Blob([new Uint8Array(image)]), "map.png");
    return this.call<TgMessage>("sendPhoto", fd, 60_000);
  }

  answerCallback(id: string, text?: string, showAlert = false) {
    return this.call<boolean>("answerCallbackQuery", { callback_query_id: id, ...(text ? { text: text.slice(0, 190), show_alert: showAlert } : {}) });
  }

  setMyCommands(commands: { command: string; description: string }[], scope: Record<string, unknown>) {
    return this.call<boolean>("setMyCommands", { commands, scope });
  }

  deleteMyCommands(scope: Record<string, unknown>) {
    return this.call<boolean>("deleteMyCommands", { scope });
  }

  setChatMenuButton(chatId: string | number) {
    return this.call<boolean>("setChatMenuButton", { chat_id: chatId, menu_button: { type: "commands" } });
  }

  // Скачивает файл из сообщения в dest.
  async downloadFile(fileId: string, dest: string): Promise<void> {
    const file = await this.call<{ file_path?: string }>("getFile", { file_id: fileId });
    if (!file.file_path) throw new Error("Telegram не отдал путь к файлу");
    let res: Response;
    try {
      res = await fetch(`https://api.telegram.org/file/bot${this.token}/${file.file_path}`, { signal: AbortSignal.timeout(10 * 60_000) });
    } catch {
      throw new TelegramNetworkError("Не удалось скачать файл из Telegram: нет связи");
    }
    if (!res.ok || !res.body) throw new Error(`Не удалось скачать файл из Telegram: ответ ${res.status}`);
    try {
      await pipeline(Readable.fromWeb(res.body as import("node:stream/web").ReadableStream), createWriteStream(dest));
    } catch (err) {
      await unlink(dest).catch(() => undefined);
      throw err;
    }
  }
}
