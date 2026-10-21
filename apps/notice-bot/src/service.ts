import {
  NOTICE_KIND_LABEL,
  buildPromoSpec,
  defaultTemplateId,
  noticeWipesBetween,
  prisma,
  renderNotice,
  type NoticeEvent,
  type NoticeKind,
  type NoticeTemplate,
  Prisma,
  type PromoSpec,
} from "@flamebot/core";
import { TelegramError, TelegramNetworkError, type InlineKeyboard } from "@flamebot/core/telegram";
import { SendError, sendDiscord } from "./clients/discord.js";
import { PromoError, createPromo, deletePromos, findActive, listPromos, type StorePromo } from "./clients/gamestores.js";
import { sendVk } from "./clients/vk.js";
import { config } from "./config.js";
import { errorText, event, log, sleep } from "./events.js";
import * as msg from "./messages.js";
import { ctx, type Targets } from "./state.js";

// Все изменения событий идут по одному: два одновременных нажатия (Telegram и панель)
// не отправят объявление дважды и не создадут два промокода. Методы, обёрнутые в serial,
// вызываются только снаружи; внутри очереди используются их версии без обёртки.
let chain: Promise<unknown> = Promise.resolve();
export function serial<T>(fn: () => Promise<T>): Promise<T> {
  const run = chain.catch(() => undefined).then(fn);
  chain = run.catch(() => undefined);
  return run;
}

export interface Outcome {
  ok: boolean;
  text: string;
}

type Msgs = [string | number, number][];
type StoredPromo = { id: number | null; code: string; amount: number; date_end: string };

const zone = (): msg.Zone => ({ tz: ctx().settings.timezone, label: ctx().settings.timezoneLabel });
const minutes = (n: number) => n * 60_000;
const msgsOf = (ev: NoticeEvent) => (Array.isArray(ev.msgs) ? (ev.msgs as Msgs) : []);
const resultsOf = (ev: NoticeEvent) => (ev.results ?? {}) as msg.Results;
const promoOf = (ev: NoticeEvent) => (ev.promo ?? null) as StoredPromo | null;
const panelLink = (key?: string) => (config.PANEL_URL ? `${config.PANEL_URL}/notices${key ? `/wipes/${encodeURIComponent(key)}` : ""}` : null);

// ====================================================================== Telegram
// Telegram — оформление, а не логика: его сбой никогда не прерывает отправку объявления.
// Если Telegram не принял токен, минуту к нему не обращаемся, чтобы действия из панели не ждали.
let tgBlockedUntil = 0;

async function tg<T>(fn: (t: NonNullable<ReturnType<typeof ctx>["telegram"]>) => Promise<T>): Promise<T | null> {
  const t = ctx().telegram;
  if (!t || Date.now() < tgBlockedUntil) return null;
  for (const delay of [2, 5, null]) {
    try {
      return await fn(t);
    } catch (err) {
      if (err instanceof TelegramError && (err.code === 401 || err.code === 404)) {
        tgBlockedUntil = Date.now() + 60_000;
        log.error("Telegram не принял токен бота: замени его в панели («Подключение»)");
        return null;
      }
      if (delay === null) throw err;
      if (err instanceof TelegramError && err.retryAfter) await sleep((err.retryAfter + 1) * 1000);
      else if (err instanceof TelegramNetworkError) await sleep(delay * 1000);
      else throw err;
    }
  }
  return null;
}

const markupProblem = (err: unknown) => err instanceof TelegramError && /parse entities|too long/i.test(err.description);

// Если Telegram не принял разметку или длину, шлём то же простым текстом: уведомление не должно потеряться.
export async function sendText(chat: string | number, text: string, kb?: InlineKeyboard | null): Promise<number | null> {
  try {
    return (await tg((t) => t.sendMessage(chat, text, kb)))?.message_id ?? null;
  } catch (err) {
    if (!markupProblem(err)) throw err;
    return (await tg((t) => t.sendMessage(chat, msg.clip(msg.plain(text), 4000), kb, false)))?.message_id ?? null;
  }
}

export async function editText(chat: string | number, id: number, text: string, kb: InlineKeyboard | null): Promise<void> {
  try {
    await tg((t) => t.editMessageText(chat, id, text, kb));
  } catch (err) {
    if (err instanceof TelegramError && /not modified/i.test(err.description)) return;
    if (!markupProblem(err)) throw err;
    await tg((t) => t.editMessageText(chat, id, msg.clip(msg.plain(text), 4000), kb, false));
  }
}

// Шлёт всем админам; возвращает [[chatId, messageId], …] текстовых сообщений.
export async function broadcast(text: string, kb?: InlineKeyboard | null, photo?: { kind: NoticeKind } | null): Promise<Msgs> {
  const sent: Msgs = [];
  for (const admin of ctx().adminIds) {
    try {
      const img = photo ? ctx().images[photo.kind] : undefined;
      if (img) await tg((t) => t.sendPhoto(admin, img.data, msg.photoCaption(photo!.kind)));
      const id = await sendText(admin, text, kb);
      if (id) sent.push([admin, id]);
    } catch (err) {
      log.warn(`Не удалось написать админу ${admin} в Telegram`, err);
    }
  }
  return sent;
}

// Убирает кнопки у ранее отправленных сообщений.
export async function clearMsgs(msgs: Msgs): Promise<void> {
  for (const [chat, id] of msgs) await tg((t) => t.editMessageReplyMarkup(chat, id, null)).catch(() => undefined);
}

// ====================================================================== сервис

export class NoticeService {
  now = () => new Date();

  // ---------------------------------------------------------------- карточка

  template(ev: Pick<NoticeEvent, "templateId">): NoticeTemplate {
    const t = ctx().templates.get(ev.templateId);
    if (!t) throw new Error(`Текст «${ev.templateId}» удалён из панели: выбери другой`);
    return t;
  }

  private targets(ev: NoticeEvent): Targets {
    return ev.isTest ? ctx().test : ctx().live;
  }

  promoSpec(ev: NoticeEvent): PromoSpec | null {
    const tpl = this.template(ev);
    if (!tpl.promoAmount) return null;
    return buildPromoSpec(ctx().settings, tpl.promoAmount, ev.wipeAt);
  }

  private promoLine(ev: NoticeEvent): msg.PromoLine | null {
    const spec = this.promoSpec(ev);
    const existing = promoOf(ev);
    if (!spec) return existing ? { code: existing.code, amount: existing.amount, dateEnd: existing.date_end, state: "remove" } : null;
    if (!existing) return { code: spec.code, amount: spec.amount, dateEnd: spec.dateEnd, state: "pending" };
    const same = existing.code === spec.code && existing.amount === spec.amount && existing.date_end === spec.dateEnd;
    return { code: spec.code, amount: spec.amount, dateEnd: spec.dateEnd, state: same ? "created" : "replace" };
  }

  compose(ev: NoticeEvent, header: string): { text: string; kb: InlineKeyboard } {
    const tpl = this.template(ev);
    const rendered = renderNotice(tpl, ev.wipeAt, ctx().settings.timezone);
    const t = this.targets(ev);
    const text = msg.eventCard(ev, tpl, rendered, {
      header,
      now: this.now(),
      z: zone(),
      promo: this.promoLine(ev),
      vkUrl: t.vkGroupId ? `https://vk.com/club${t.vkGroupId}` : null,
      panelUrl: ev.isTest ? null : panelLink(ev.key),
    });
    return { text, kb: msg.mainKb(ev) };
  }

  defaultHeader(ev: NoticeEvent): string {
    return ev.confirmed ? msg.hConfirmed(null, ev.confirmedBy) : msg.hNotify(ev.isTest);
  }

  // Обновляет карточку у всех админов: после действия в панели или у другого админа в Telegram.
  private async refreshCards(ev: NoticeEvent, header: string): Promise<void> {
    if (ev.status !== "pending") return;
    const { text, kb } = this.compose(ev, header);
    for (const [chat, id] of msgsOf(ev)) await editText(chat, id, text, kb).catch((err) => log.info(`Карточка в Telegram не обновилась: ${errorText(err)}`));
  }

  // ---------------------------------------------------------------- цикл

  async startup(): Promise<void> {
    const s = ctx().settings;
    for (const ev of await prisma.noticeEvent.findMany({ where: { status: "sending" } })) {
      // Бот упал посреди отправки: результат неизвестен.
      await prisma.noticeEvent.update({ where: { key: ev.key }, data: { status: "partial" } });
      await broadcast(msg.interrupted(ev, zone()));
      event("send.interrupted", `Отправка объявления ${ev.key} была прервана перезапуском бота: проверь Discord и ВКонтакте`, { level: "WARN" });
    }
    const next = noticeWipesBetween(ctx().rules, s.timezone, this.now(), new Date(Date.now() + 8 * 86_400_000))[0];
    const c = ctx();
    const agenda = s.agendaEnabled
      ? c.agenda.size
        ? `📋 План дня в ${s.agendaSendAt}${c.reminders.length ? ` · напоминаний: ${c.reminders.length}` : ""}`
        : null
      : "🔕 План дня и напоминания отключены (/plan_on — включить)";
    await broadcast(
      msg.startup(
        next ? { at: next.wipeAt, kind: next.kind } : null,
        zone(),
        { discord: !!c.live.discord, vk: !!(c.live.vkToken && c.live.vkGroupId), gs: !!c.gamestores },
        c.missing,
        agenda,
        s.dryRun,
      ),
    );
  }

  private warnedRules = new Set<string>();

  async tick(): Promise<void> {
    const now = this.now();
    const s = ctx().settings;
    // Заводим записи для вайпов из окна «уведомление … допустимое опоздание».
    for (const w of noticeWipesBetween(ctx().rules, s.timezone, new Date(now.getTime() - minutes(s.maxLateMinutes)), new Date(now.getTime() + minutes(s.notifyMinutes)))) {
      const templateId = defaultTemplateId(w.rule, w.kind);
      if (!templateId || !ctx().templates.has(templateId)) {
        if (!this.warnedRules.has(w.key)) {
          this.warnedRules.add(w.key);
          log.error(`Вайп ${msg.fmtDay(w.wipeAt, zone())} ${msg.hm(w.wipeAt, zone())}: в правиле «${w.rule.key}» не выбран текст для типа «${NOTICE_KIND_LABEL[w.kind]}». Выбери его в панели («Расписание»)`);
        }
        continue;
      }
      await prisma.noticeEvent.createMany({ data: [{ key: w.key, wipeAt: w.wipeAt, kind: w.kind, templateId }], skipDuplicates: true });
    }
    for (const ev of await prisma.noticeEvent.findMany({ where: { status: "pending" }, orderBy: { wipeAt: "asc" } })) {
      try {
        await this.advance(ev, now);
      } catch (err) {
        log.error(`Ошибка обработки вайпа ${ev.key}`, err);
      }
    }
  }

  private async advance(ev: NoticeEvent, now: Date): Promise<void> {
    const s = ctx().settings;
    const remaining = ev.wipeAt.getTime() - now.getTime();
    if (remaining <= 0) {
      if (!ev.notified) {
        // Уведомления не было (бот был выключен): слать вслепую небезопасно.
        await prisma.noticeEvent.update({ where: { key: ev.key }, data: { status: "missed" } });
        await broadcast(msg.missedNoNotice(ev, zone()));
        event("wipe.missed", `Вайп ${ev.key} пропущен: бот был выключен и не спросил подтверждение, ничего не отправлено`, { level: "WARN" });
      } else if (-remaining > minutes(s.maxLateMinutes)) {
        await prisma.noticeEvent.update({ where: { key: ev.key }, data: { status: "missed" } });
        await clearMsgs(msgsOf(ev));
        await broadcast(msg.missedTooLate(ev, zone(), s.maxLateMinutes));
        event("wipe.missed", `Вайп ${ev.key} пропущен: время отправки прошло больше чем на ${s.maxLateMinutes} мин`, { level: "WARN" });
      } else {
        await this.dispatchInner(ev.key, false);
      }
    } else if (!ev.notified) {
      await this.notify(ev);
    } else if (!ev.confirmed && !ev.reminded && remaining <= minutes(s.remindMinutes)) {
      const { text, kb } = this.compose(ev, msg.hRemind(ev.isTest));
      const sent = await broadcast(text, kb);
      await prisma.noticeEvent.update({ where: { key: ev.key }, data: { reminded: true, msgs: [...msgsOf(ev), ...sent] } });
    }
  }

  private async notify(ev: NoticeEvent): Promise<void> {
    const remaining = ev.wipeAt.getTime() - this.now().getTime();
    const { text, kb } = this.compose(ev, msg.hNotify(ev.isTest));
    const sent = await broadcast(text, kb, { kind: ev.kind as NoticeKind });
    // Если до вайпа уже меньше окна напоминания, отдельное напоминание не нужно.
    await prisma.noticeEvent.update({
      where: { key: ev.key },
      data: { notified: true, reminded: remaining <= minutes(ctx().settings.remindMinutes), msgs: [...msgsOf(ev), ...sent] },
    });
    if (!ev.isTest) event("wipe.notified", `Вайп ${ev.key}: текст «${this.template(ev).title}» отправлен на подтверждение`);
  }

  // ---------------------------------------------------------------- действия

  private async pending(key: string): Promise<NoticeEvent | null> {
    const ev = await prisma.noticeEvent.findUnique({ where: { key } });
    return ev && ev.status === "pending" ? ev : null;
  }

  confirm(key: string, by: string): Promise<Outcome> {
    return serial(async () => {
      const ev = await this.pending(key);
      if (!ev) return { ok: false, text: msg.STALE };
      const outcome = await this.ensurePromo(ev);
      if (outcome.state === "error") {
        // Подтверждение не принимаем: текст ссылается на промокод, которого нет. Повторное нажатие повторит попытку.
        await this.refreshCards(ev, msg.hPromoFailed(outcome));
        event("promo.error", `Вайп ${key}: промокод не создан, подтверждение не принято — ${outcome.text}`, { level: "ERROR" });
        return { ok: false, text: `Промокод не создан: ${outcome.text}` };
      }
      const updated = await prisma.noticeEvent.update({ where: { key }, data: { confirmed: true, confirmedBy: by } });
      await this.refreshCards(updated, msg.hConfirmed(outcome, by));
      if (!ev.isTest) event("wipe.confirmed", `Вайп ${key}: ${by} подтвердил текст «${this.template(updated).title}»${outcome.state === "ok" ? `, промокод ${outcome.code} — ${outcome.text}` : ""}`);
      const note = outcome.state === "none" || outcome.state === "ok" ? "" : ` Промокод: ${outcome.text}`;
      return { ok: true, text: `Подтверждено: уйдёт в назначенное время.${note}` };
    });
  }

  pickTemplate(key: string, templateId: string, by: string): Promise<Outcome & { kindChanged?: boolean }> {
    return serial(async () => {
      const ev = await this.pending(key);
      if (!ev) return { ok: false, text: msg.STALE };
      const tpl = ctx().templates.get(templateId);
      if (!tpl) return { ok: false, text: "Такого текста больше нет" };
      const kindChanged = tpl.kind !== ev.kind;
      const updated = await prisma.noticeEvent.update({ where: { key }, data: { templateId: tpl.id, kind: tpl.kind, confirmed: false, confirmedBy: null } });
      await this.refreshCards(updated, msg.hChanged(by));
      if (kindChanged) {
        for (const [chat] of msgsOf(updated)) {
          const img = ctx().images[tpl.kind as NoticeKind];
          if (img) await tg((t) => t.sendPhoto(chat, img.data, msg.photoCaption(tpl.kind as NoticeKind))).catch(() => undefined);
        }
      }
      if (!ev.isTest) event("wipe.template", `Вайп ${key}: ${by} выбрал текст «${tpl.title}»`);
      return { ok: true, text: `Текст изменён на «${tpl.title}». Его нужно подтвердить заново.`, kindChanged };
    });
  }

  skip(key: string, by: string): Promise<Outcome> {
    return serial(async () => {
      const ev = await this.pending(key);
      if (!ev) return { ok: false, text: msg.STALE };
      await prisma.noticeEvent.update({ where: { key }, data: { status: "skipped" } });
      await clearMsgs(msgsOf(ev));
      // Промокод, созданный под этот вайп, больше не нужен.
      const released = promoOf(ev) ? await this.dropPromo(ev, "вайп отменён") : null;
      let note = "";
      if (released?.state === "ok") note = `🎟 Промокод <code>${msg.e(released.code)}</code> удалён.`;
      else if (released) note = `⚠️ Промокод <code>${msg.e(released.code)}</code>: ${msg.e(msg.clip(released.text, 300))}`;
      const text = msg.skipped(ev, zone(), note, by);
      for (const [chat, id] of msgsOf(ev)) await editText(chat, id, text, null).catch(() => undefined);
      if (!ev.isTest) event("wipe.skipped", `Вайп ${key}: ${by} отменил отправку${released ? `, промокод: ${released.text}` : ""}`, { level: "WARN" });
      return { ok: true, text: `Отправка отменена.${released ? ` Промокод: ${released.text}` : ""}` };
    });
  }

  retry(key: string): Promise<Outcome> {
    return serial(async () => {
      const ev = await prisma.noticeEvent.findUnique({ where: { key } });
      if (!ev || ev.status !== "partial") return { ok: false, text: msg.STALE };
      return this.dispatchInner(key, true);
    });
  }

  startTest(kind: NoticeKind, inMinutes: number): Promise<Outcome> {
    return serial(async () => {
      // Тест берёт текст по умолчанию пятничного правила: в пятницу бывают оба типа. Иначе — первый подходящий.
      const rules = [...ctx().rules].sort((a, b) => (b.weekday === 4 ? 1 : 0) - (a.weekday === 4 ? 1 : 0));
      const id = rules.map((r) => defaultTemplateId(r, kind)).find((t) => t && ctx().templates.has(t)) ?? [...ctx().templates.values()].find((t) => t.kind === kind)?.id;
      if (!id) return { ok: false, text: `Нет текста для ${kind === "global" ? "глобального" : "обычного"} вайпа` };
      if (!ctx().adminIds.length || !ctx().telegram) return { ok: false, text: "Тест идёт через Telegram: подключи бота и укажи админов" };
      const ev = await prisma.noticeEvent.create({
        data: { key: `t${Date.now()}`, wipeAt: new Date(Date.now() + minutes(inMinutes)), kind, templateId: id, isTest: true },
      });
      await this.notify(ev);
      return { ok: true, text: `Тест запущен: уведомление пришло в Telegram, «вайп» через ${inMinutes} мин.` };
    });
  }

  // ---------------------------------------------------------------- отправка

  dispatch(key: string): Promise<Outcome> {
    return serial(() => this.dispatchInner(key, false));
  }

  private async dispatchInner(key: string, retry: boolean): Promise<Outcome> {
    let ev = await prisma.noticeEvent.findUnique({ where: { key } });
    if (!ev || ev.status !== (retry ? "partial" : "pending")) return { ok: false, text: msg.STALE };
    await clearMsgs(msgsOf(ev));
    ev = await prisma.noticeEvent.update({ where: { key }, data: { status: "sending", msgs: [] } });
    const tpl = this.template(ev);
    const results: msg.Results = { ...resultsOf(ev) };

    // Текст ссылается на промокод, поэтому он должен существовать до публикации. Если подтверждения не было
    // (уходит текст по умолчанию), создаём сейчас; при ошибке всё равно публикуем, но с предупреждением.
    const promo = await this.ensurePromo(ev);
    if (promo.state !== "none") results.promo = promo;

    const names = (["discord", "vk"] as const).filter((n) => !["ok", "dry"].includes(results[n]?.state ?? ""));
    const outcomes = await Promise.all(names.map((n) => this.sendOne(n, ev!, tpl)));
    names.forEach((n, i) => (results[n] = outcomes[i]));

    const failed = results.discord?.state === "error" || results.vk?.state === "error";
    ev = await prisma.noticeEvent.update({ where: { key }, data: { results: results as Prisma.InputJsonValue, status: failed ? "partial" : "sent" } });
    const sent = await broadcast(msg.resultText(ev, tpl, zone()), failed ? msg.retryKb(ev) : null);
    if (failed) await prisma.noticeEvent.update({ where: { key }, data: { msgs: sent } });

    const summary = (["discord", "vk"] as const).map((n) => `${n === "vk" ? "ВКонтакте" : "Discord"}: ${results[n]?.state === "ok" ? "отправлено" : results[n]?.state === "dry" ? "пробный прогон" : `ошибка — ${results[n]?.detail ?? "?"}`}`).join("; ");
    if (!ev.isTest) {
      event(failed ? "send.partial" : "send.done", `Вайп ${key}: ${failed ? "отправлено не везде" : "объявление опубликовано"}. ${summary}`.slice(0, 1000), {
        level: failed ? "ERROR" : "INFO",
        details: results as Prisma.InputJsonValue,
      });
    }
    return { ok: !failed, text: failed ? `Отправлено не везде. ${summary}` : `Объявление опубликовано. ${summary}` };
  }

  private async sendOne(name: "discord" | "vk", ev: NoticeEvent, tpl: NoticeTemplate): Promise<msg.SendResult> {
    const s = ctx().settings;
    const rendered = renderNotice(tpl, ev.wipeAt, s.timezone);
    const t: Targets = s.dryRun ? { discord: null, vkToken: null, vkGroupId: null, vkPhotos: {} } : this.targets(ev);
    const dryAllowed = ev.isTest || s.dryRun;
    const unconfigured = (m: string): msg.SendResult => (dryAllowed ? { state: "dry", detail: "" } : { state: "error", detail: m });
    const img = ctx().images[tpl.kind as NoticeKind];
    try {
      if (name === "discord") {
        if (!t.discord) return unconfigured("вебхук Discord не задан");
        if (!img) return { state: "error", detail: "картинка поста не загружена в панели" };
        return { state: "ok", detail: await sendDiscord(t.discord, rendered.discord, img) };
      }
      if (!t.vkToken || !t.vkGroupId) return unconfigured("ключ или ID сообщества ВКонтакте не заданы");
      const photo = t.vkPhotos[tpl.kind as NoticeKind] ?? null;
      if (!photo && !img) return { state: "error", detail: "нет ни ID фото ВКонтакте, ни картинки поста" };
      return { state: "ok", detail: await sendVk(t.vkToken, t.vkGroupId, rendered.vk, img!, photo) };
    } catch (err) {
      if (!(err instanceof SendError)) log.error(`Сбой отправки в ${name === "vk" ? "ВКонтакте" : "Discord"}`, err);
      return { state: "error", detail: errorText(err) };
    }
  }

  // ---------------------------------------------------------------- промокод

  // Приводит промокод в магазине в соответствие с выбранным текстом: создаёт, если нужен и ещё нет;
  // заменяет, если выбрали текст с другой скидкой; удаляет, если выбранному тексту он не нужен.
  // Повторный вызов ничего не дублирует.
  private async ensurePromo(ev: NoticeEvent): Promise<msg.PromoOutcome> {
    const s = ctx().settings;
    const gs = ctx().gamestores;
    let spec = this.promoSpec(ev);
    const real = !s.dryRun && (!ev.isTest || s.promoTestReal);
    // Боевой магазин не трогаем: тестовый код со скидкой 1% и одним использованием.
    if (spec && ev.isTest && real) spec = { ...spec, code: `TEST-${spec.code}-${ev.key.slice(-8)}`, amount: 1, limitUses: 1 };
    const existing = promoOf(ev);

    if (!spec) return existing ? this.dropPromo(ev, "выбранному тексту он не нужен") : { state: "none", text: "" };
    const out = (state: msg.PromoOutcome["state"], text: string): msg.PromoOutcome => ({ state, text, code: spec!.code, amount: spec!.amount, dateEnd: spec!.dateEnd });

    if (!real) return out("dry", "пробный прогон, ничего не создано");
    if (!gs) return out("error", "не заданы ID магазина и секретный ключ gamestores");

    let replaced = "";
    if (existing) {
      if (existing.code === spec.code && existing.amount === spec.amount && existing.date_end === spec.dateEnd) return out("ok", "уже создан");
      const dropped = await this.dropPromo(ev, "заменяю на другой");
      if (dropped.state !== "ok") return dropped;
      replaced = `, заменён прежний (${existing.amount}%)`;
    }

    try {
      let found: StorePromo | null = null;
      try {
        found = await findActive(gs, spec.code);
      } catch (err) {
        // Проверка дубля — удобство, а не обязательное условие.
        log.info(`promocodes.list не удался, создаю без проверки: ${errorText(err)}`);
      }
      if (found) {
        const fits = found.amount === spec.amount && found.type === spec.type && String(found.dateEnd ?? "") >= spec.dateEnd;
        if (!fits) {
          return out("warn", `в магазине уже есть активный ${found.code}: ${found.amount}% до ${found.dateEnd} (тип ${found.type}). Новый не создавал — поправь в панели магазина вручную`);
        }
        // id не сохраняем: чужой промокод бот потом ни заменять, ни удалять не будет.
        await prisma.noticeEvent.update({ where: { key: ev.key }, data: { promo: { id: null, code: spec.code, amount: spec.amount, date_end: spec.dateEnd } } });
        return out("ok", `уже есть в магазине (id ${found.id ?? "?"}), новый не создавал`);
      }
      const created = await createPromo(gs, spec);
      await prisma.noticeEvent.update({ where: { key: ev.key }, data: { promo: { id: created.id ?? null, code: spec.code, amount: spec.amount, date_end: spec.dateEnd } } });
      if (!ev.isTest) event("promo.created", `Промокод ${spec.code} (${spec.amount}%, до ${spec.dateEnd}) создан для вайпа ${ev.key}${replaced}`);
      return out("ok", `создан (id ${created.id ?? "?"})${replaced}`);
    } catch (err) {
      if (!(err instanceof PromoError)) log.error("Сбой создания промокода", err);
      return out("error", errorText(err));
    }
  }

  // Удаляет промокод, который бот сам создал для этого события.
  private async dropPromo(ev: NoticeEvent, reason: string): Promise<msg.PromoOutcome> {
    const existing = promoOf(ev)!;
    const label = `${existing.code} (${existing.amount}%)`;
    const out = (state: msg.PromoOutcome["state"], text: string): msg.PromoOutcome => ({ state, text, code: existing.code, amount: existing.amount, dateEnd: existing.date_end });
    if (!existing.id) return out("warn", `${label} создан не ботом (или id неизвестен): ${reason}, поправь в панели магазина вручную`);
    const s = ctx().settings;
    const gs = ctx().gamestores;
    if (s.dryRun || !gs || (ev.isTest && !s.promoTestReal)) return out("dry", `пробный прогон: удалил бы ${label}`);
    try {
      await deletePromos(gs, [existing.id]);
    } catch (err) {
      if (!(err instanceof PromoError)) log.error("Сбой удаления промокода", err);
      return out("error", `не удалось удалить ${label}: ${errorText(err)}`);
    }
    await prisma.noticeEvent.update({ where: { key: ev.key }, data: { promo: Prisma.DbNull } });
    if (!ev.isTest) event("promo.deleted", `Промокод ${label} удалён: ${reason} (вайп ${ev.key})`);
    return out("ok", `удалён — ${reason}`);
  }

  async promos(): Promise<StorePromo[] | null> {
    const gs = ctx().gamestores;
    return gs ? listPromos(gs) : null;
  }
}

export const service = new NoticeService();
