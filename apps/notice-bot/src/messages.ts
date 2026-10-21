import {
  NOTICE_KIND_ICON,
  NOTICE_KIND_LABEL,
  NOTICE_KIND_NOTE,
  fmtPromoEnd,
  zonedParts,
  type NoticeEvent,
  type NoticeKind,
  type NoticeReminder,
  type NoticeTemplate,
} from "@flamebot/core";
import type { InlineButton, InlineKeyboard } from "@flamebot/core/telegram";

// Тексты сообщений бота в Telegram (HTML) и клавиатуры. Перенесены из прежнего бота.
// Правила вёрстки, чтобы Telegram не отверг сообщение: всё динамическое проходит через e(),
// <code>/<pre> ни во что не вкладываются, длинное режется до добавления тегов.

export const SEP = "━━━━━━━━━━━━━━━━";
const EMOJI_RE = /<a?:\w+:\d+>/g; // кастомные эмодзи Discord
const BOLD_RE = /\*\*(.+?)\*\*/gs;
const LINK_RE = /\[([^\]\n]+)\]\((https?:\/\/[^)\s]+)\)/g;
const PING_RE = /^@(everyone|here)$/;

export const e = (x: unknown) => String(x).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
const attr = (x: string) => e(x).replaceAll('"', "&quot;");
export const clip = (text: string, limit: number) => (text.length <= limit ? text : `${text.slice(0, limit - 1).trimEnd()}…`);
export const plain = (html: string) =>
  html.replace(/<[^>]+>/g, "").replaceAll("&lt;", "<").replaceAll("&gt;", ">").replaceAll("&quot;", '"').replaceAll("&amp;", "&");
export const quote = (body: string) => {
  const expandable = (body.match(/\n/g) ?? []).length >= 7;
  return expandable ? `<blockquote expandable>${body}</blockquote>` : `<blockquote>${body}</blockquote>`;
};

// Время в поясе модуля: tz — IANA, label — подпись («МСК»).
export interface Zone {
  tz: string;
  label: string;
}

const WEEKDAY_CAP = ["Понедельник", "Вторник", "Среда", "Четверг", "Пятница", "Суббота", "Воскресенье"];
const WEEKDAY_SHORT = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];
const MONTHS_GEN = ["января", "февраля", "марта", "апреля", "мая", "июня", "июля", "августа", "сентября", "октября", "ноября", "декабря"];
const KEYCAPS = ["1️⃣", "2️⃣", "3️⃣", "4️⃣", "5️⃣", "6️⃣", "7️⃣", "8️⃣", "9️⃣", "🔟"];
const pad = (n: number) => String(n).padStart(2, "0");

export const hm = (d: Date, z: Zone) => {
  const p = zonedParts(d, z.tz);
  return `${pad(p.hour)}:${pad(p.minute)}`;
};
export const fmtDay = (d: Date, z: Zone) => {
  const p = zonedParts(d, z.tz);
  return `${WEEKDAY_CAP[p.weekday]}, ${pad(p.day)}.${pad(p.month)}`;
};
const fmtShort = (d: Date, z: Zone) => {
  const p = zonedParts(d, z.tz);
  return `${WEEKDAY_SHORT[p.weekday]} ${pad(p.day)}.${pad(p.month)}`;
};

export function fmtRemaining(ms: number): string {
  const minutes = Math.max(Math.floor(ms / 60_000), 0);
  const h = Math.floor(minutes / 60);
  return h ? `${h} ч ${minutes % 60} мин` : `${minutes} мин`;
}

const kindShort = (kind: NoticeKind) => `${NOTICE_KIND_ICON[kind]} ${NOTICE_KIND_LABEL[kind]}`;
export const kindLine = (kind: NoticeKind) =>
  `${NOTICE_KIND_ICON[kind]} <b>${kind === "global" ? "Глобальный вайп" : "Обычный вайп"}</b> · ${NOTICE_KIND_NOTE[kind]}`;

function whenLines(d: Date, z: Zone, now?: Date): string[] {
  const lines = [`🗓 <b>${fmtDay(d, z)}</b> · <b>${hm(d, z)}</b> ${e(z.label)}`];
  if (now && d > now) lines.push(`⏳ Осталось <b>${fmtRemaining(d.getTime() - now.getTime())}</b>`);
  return lines;
}

const testBadge = (isTest: boolean) => (isTest ? "  🧪 <i>тест</i>" : "");

// ---------------------------------------------------------------- превью Discord / ВКонтакте

// Разметка Discord → HTML Telegram: **жирный**, [текст](ссылка); кастомные эмодзи → маркер.
function md(text: string): string {
  return e(text.replace(EMOJI_RE, "▪️"))
    .replace(LINK_RE, (_, label: string, url: string) => `<a href="${url.replaceAll('"', "%22")}">${label}</a>`)
    .replace(BOLD_RE, "<b>$1</b>");
}

export function discordPreview(payload: Record<string, unknown>): { ping: string; body: string } {
  let ping = "";
  const body: string[] = [];
  const content = String(payload.content ?? "").trim();
  if (content) {
    // В <code>, иначе Telegram сделает из @everyone ссылку на пользователя.
    if (PING_RE.test(content)) ping = `📣 <code>${e(content)}</code>`;
    else body.push(md(clip(content, 600)));
  }
  for (const embed of (Array.isArray(payload.embeds) ? payload.embeds : []) as Record<string, unknown>[]) {
    if (embed.title) body.push(`<b>${e(clip(String(embed.title), 200).replace(EMOJI_RE, "▪️"))}</b>`);
    if (embed.description) body.push(md(clip(String(embed.description).trim(), 1000)));
    for (const f of (Array.isArray(embed.fields) ? embed.fields : []) as Record<string, unknown>[]) {
      body.push(`<b>${e(f.name ?? "")}</b>\n${md(clip(String(f.value ?? ""), 300))}`);
    }
    const footer = (embed.footer as { text?: string } | undefined)?.text;
    if (footer) body.push(`<i>${e(footer)}</i>`);
  }
  return { ping, body: body.join("\n") || "<i>(пусто)</i>" };
}

// ---------------------------------------------------------------- промокод

export interface PromoLine {
  code: string;
  amount: number;
  dateEnd: string; // «2026-10-07 23:59»
  state: "created" | "pending" | "replace" | "remove";
}

const promoTag = (code: string, amount: unknown, dateEnd: string | null | undefined) =>
  `<code>${e(code)}</code> · ${e(amount)}%${dateEnd ? ` · до ${fmtPromoEnd(dateEnd)}` : ""}`;

function promoCardLine(p: PromoLine): string {
  const note = {
    created: "✅ создан",
    pending: "создам при подтверждении",
    replace: "при подтверждении заменю прежний",
    remove: "при подтверждении удалю: этому тексту он не нужен",
  }[p.state];
  return `🎟 Промокод ${promoTag(p.code, p.amount, p.dateEnd)} — ${note}`;
}

// ---------------------------------------------------------------- карточка вайпа

export function eventCard(
  ev: NoticeEvent,
  tpl: NoticeTemplate,
  rendered: { discord: Record<string, unknown>; vk: string },
  o: { header: string; now: Date; z: Zone; promo: PromoLine | null; vkUrl: string | null; panelUrl: string | null },
): string {
  const { ping, body } = discordPreview(rendered.discord);
  const vkLabel = o.vkUrl ? `<a href="${attr(o.vkUrl)}">ВКонтакте</a>` : "ВКонтакте";
  const lines = [o.header, SEP, kindLine(tpl.kind as NoticeKind), ...whenLines(ev.wipeAt, o.z, o.now), `📝 <i>${e(tpl.title)}</i>`];
  if (o.promo) lines.push(promoCardLine(o.promo));
  lines.push("", "<b>Discord</b>", ...(ping ? [ping] : []), quote(body), "", `<b>${vkLabel}</b>`, quote(e(clip(rendered.vk.trim(), 1000))));
  if (!ev.confirmed) lines.push("", `<i>Без подтверждения в ${hm(ev.wipeAt, o.z)} уйдёт этот текст.</i>`);
  if (o.panelUrl) lines.push(`🖥 <a href="${attr(o.panelUrl)}">Открыть в панели</a>`);
  return lines.join("\n");
}

export const hNotify = (isTest: boolean) => `🔔 <b>Подтвердите вайп</b>${testBadge(isTest)}`;
export const hRemind = (isTest: boolean) => `⏰ <b>Напоминание</b>${testBadge(isTest)}\nСкоро вайп, а текст всё ещё не подтверждён.`;
export const hChanged = (by?: string) => `✏️ <b>Текст изменён</b>${by ? ` · ${e(by)}` : ""}\nПроверьте и подтвердите ещё раз.`;
export const hPick = () => "✏️ <b>Выберите текст</b>\nОн заменит текущий; тип вайпа и картинка подстроятся.";
export const hSkip = () => "🚫 <b>Не отправлять этот вайп?</b>\nНи в Discord, ни во ВКонтакте ничего не уйдёт.";

export interface PromoOutcome {
  state: "none" | "ok" | "warn" | "dry" | "error";
  text: string;
  code?: string;
  amount?: number;
  dateEnd?: string;
}

export function hConfirmed(outcome?: PromoOutcome | null, by?: string | null): string {
  const head = `✅ <b>Подтверждено</b>${by ? ` · ${e(by)}` : ""}\nОтправлю автоматически в назначенное время.`;
  if (!outcome || outcome.state === "none" || outcome.state === "ok") return head;
  const icon = outcome.state === "warn" ? "⚠️" : outcome.state === "dry" ? "🧪" : "❌";
  return `${head}\n${icon} Промокод: ${e(clip(outcome.text, 400))}`;
}

export const hPromoFailed = (o: PromoOutcome) =>
  `⚠️ <b>Промокод не создан — подтверждение не принято</b>\n${quote(e(clip(o.text, 500)))}\nНажмите «Подтвердить», чтобы повторить попытку.`;

export const photoCaption = (kind: NoticeKind) => `🖼 <b>Картинка поста</b> · ${kindShort(kind)} вайп\nПрикрепится к Discord и ВКонтакте.`;

// ---------------------------------------------------------------- результат отправки

export interface SendResult {
  state: "ok" | "dry" | "error";
  detail?: string;
}

function resultRow(label: string, res: SendResult, isVk: boolean): string[] {
  const detail = res.detail ?? "";
  if (res.state === "ok") {
    if (isVk && detail.startsWith("https://")) return [`✅ <b>${label}</b> — <a href="${attr(detail)}">пост опубликован</a>`];
    return [`✅ <b>${label}</b> — отправлено`];
  }
  if (res.state === "dry") return [`🧪 <b>${label}</b> — пробный прогон, наружу ничего не ушло`];
  return [`❌ <b>${label}</b> — ошибка`, quote(e(clip(detail || "причина неизвестна", 500)))];
}

function promoResultRow(res: PromoOutcome): string[] {
  const icon = { ok: "✅", dry: "🧪", warn: "⚠️", error: "❌", none: "❔" }[res.state];
  const head = `${icon} <b>Промокод</b>${res.code ? ` ${promoTag(res.code, res.amount, res.dateEnd)}` : ""}`;
  const detail = e(clip(res.text ?? "", 400));
  if (res.state === "error") return [`${head} — не создан`, quote(detail)];
  return [detail ? `${head} — ${detail}` : head];
}

export interface Results {
  discord?: SendResult;
  vk?: SendResult;
  promo?: PromoOutcome;
}

export function resultText(ev: NoticeEvent, tpl: NoticeTemplate, z: Zone): string {
  const r = (ev.results ?? {}) as Results;
  const states = new Set([r.discord?.state, r.vk?.state].filter(Boolean));
  const title = states.has("error") ? "⚠️ <b>Отправлено не везде</b>" : states.size === 1 && states.has("dry") ? "🧪 <b>Пробный прогон завершён</b>" : "📤 <b>Вайп опубликован</b>";
  const missing: SendResult = { state: "error", detail: "не отправлялось" };
  const lines = [title + testBadge(ev.isTest), SEP, kindLine(tpl.kind as NoticeKind), ...whenLines(ev.wipeAt, z), `📝 <i>${e(tpl.title)}</i>`, ""];
  lines.push(...resultRow("Discord", r.discord ?? missing, false), ...resultRow("ВКонтакте", r.vk ?? missing, true));
  if (r.promo) lines.push(...promoResultRow(r.promo));
  if (states.has("error")) lines.push("", "<i>Кнопка ниже повторит только неудавшиеся площадки; удавшиеся не продублируются.</i>");
  return lines.join("\n");
}

// ---------------------------------------------------------------- план дня и напоминания

const CODE_SPAN = /(`[^`\n]+`)/;

// Лёгкая разметка в пунктах плана: **жирный** и `код`.
export function inline(text: string): string {
  return e(text)
    .split(CODE_SPAN)
    .map((p, i) => (i % 2 ? `<code>${p.slice(1, -1)}</code>` : p.replace(BOLD_RE, "<b>$1</b>")))
    .join("");
}

export const fillTokens = (text: string, c: Record<string, string>) => Object.entries(c).reduce((t, [k, v]) => t.replaceAll(`{${k}}`, v), text);

const planItems = (items: string[], c: Record<string, string>) => items.map((it, i) => `${KEYCAPS[i] ?? `${i + 1}.`} ${inline(fillTokens(it, c))}`);

export function agendaText(now: Date, z: Zone, items: string[], greeting: string, c: Record<string, string>): string {
  const p = zonedParts(now, z.tz);
  return [
    `☀️ <b>${e(greeting)}</b>`,
    `Сегодня — <b>${WEEKDAY_CAP[p.weekday]!.toLowerCase()}</b>, ${p.day} ${MONTHS_GEN[p.month - 1]}`,
    SEP,
    "📋 <b>По плану</b>",
    "",
    ...planItems(items, c),
  ].join("\n");
}

export const agendaForDay = (weekday: number, items: string[], c: Record<string, string>) =>
  [`📋 <b>План: ${WEEKDAY_CAP[weekday]!.toLowerCase()}</b>`, SEP, ...planItems(items, c)].join("\n");

export const agendaNone = (weekday: number, today: boolean) => ["📋 <b>План</b>", SEP, `На ${today ? "сегодня" : WEEKDAY_CAP[weekday]!.toLowerCase()} плана нет.`].join("\n");

export function reminderText(rem: NoticeReminder, number: number, total: number, following: string | null, isTest: boolean): string {
  const tail = following ? `следующее в ${following}` : "последнее на сегодня";
  return [`<b>${e(rem.title)}</b>${testBadge(isTest)}`, SEP, inline(rem.text), "", `<i>Напоминание ${number} из ${total} · ${tail}</i>`].join("\n");
}

export const reminderDone = (rem: NoticeReminder, at: string, z: Zone, isTest: boolean, by?: string) =>
  [`✅ <b>${e(rem.title)}</b>${testBadge(isTest)}`, SEP, `Отмечено в ${at} ${e(z.label)}${by ? ` · ${e(by)}` : ""}. ${e(rem.doneText)}`].join("\n");

export function agendaOff(already: boolean): string {
  return [
    already ? "🔕 <b>Уведомления расписания уже отключены</b>" : "🔕 <b>Уведомления расписания отключены</b>",
    SEP,
    "План дня и напоминания приходить не будут.",
    "Уведомления о вайпах не затронуты: они работают как раньше.",
    "",
    "Включить обратно: /plan_on",
  ].join("\n");
}

export function agendaOn(next: Date | null, z: Zone, already: boolean): string {
  const lines = [already ? "🔔 <b>Уведомления расписания уже включены</b>" : "🔔 <b>Уведомления расписания включены</b>", SEP];
  if (next) lines.push(`Ближайший план придёт: <b>${fmtDay(next, z)}</b> · <b>${hm(next, z)}</b> ${e(z.label)}.`);
  lines.push("Отключить: /plan_off");
  return lines.join("\n");
}

// ---------------------------------------------------------------- служебные

export function skipped(ev: NoticeEvent, z: Zone, promoNote: string, by?: string | null): string {
  const lines = [`🚫 <b>Отправка отменена</b>${by ? ` · ${e(by)}` : ""}`, SEP, kindLine(ev.kind as NoticeKind), ...whenLines(ev.wipeAt, z), "", "Ни в Discord, ни во ВКонтакте ничего не уйдёт."];
  if (promoNote) lines.push("", promoNote);
  return lines.join("\n");
}

export const missedNoNotice = (ev: NoticeEvent, z: Zone) =>
  [
    "⚠️ <b>Вайп пропущен ботом</b>",
    SEP,
    kindLine(ev.kind as NoticeKind),
    ...whenLines(ev.wipeAt, z),
    "",
    "Бот был выключен и не успел спросить подтверждение, поэтому <b>ничего не отправлено</b>.",
    "<i>Если нужно, опубликуйте объявление вручную.</i>",
  ].join("\n");

export const missedTooLate = (ev: NoticeEvent, z: Zone, graceMinutes: number) =>
  [
    "⚠️ <b>Время отправки прошло</b>",
    SEP,
    kindLine(ev.kind as NoticeKind),
    ...whenLines(ev.wipeAt, z),
    "",
    `Бот был недоступен дольше ${graceMinutes} мин после назначенного времени, поэтому <b>ничего не отправлено</b>.`,
    "<i>Если нужно, опубликуйте объявление вручную.</i>",
  ].join("\n");

export const interrupted = (ev: NoticeEvent, z: Zone) =>
  [
    "⚠️ <b>Отправка была прервана</b>",
    SEP,
    kindLine(ev.kind as NoticeKind),
    ...whenLines(ev.wipeAt, z),
    "",
    "Бот перезапустился посреди отправки, результат неизвестен.",
    "<i>Проверьте Discord и ВКонтакте вручную, прежде чем что-либо повторять.</i>",
  ].join("\n");

export const STALE = "Это уведомление уже обработано";

export function helpText(notifyMinutes: number, panelUrl: string | null): string {
  return [
    "🤖 <b>Бот объявлений о вайпе</b>",
    `Присылаю текст на подтверждение за ${Math.round((notifyMinutes / 60) * 10) / 10} ч до вайпа и публикую его в Discord и ВКонтакте.`,
    "",
    "<b>Команды</b>",
    "/schedule — ближайшие вайпы",
    "/plan — план на сегодня (<code>/plan вторник</code> — на другой день)",
    "/plan_off · /plan_on — отключить / включить план дня и напоминания",
    "/test — тестовый прогон",
    "/remind — тестовое напоминание с кнопкой",
    "/promos — активные промокоды gamestores",
    "",
    quote("Не нажали «Подтвердить» — в назначенное время уйдёт текст по умолчанию.\nТексты, расписание и план дня меняются в панели."),
    ...(panelUrl ? [`🖥 <a href="${attr(panelUrl)}">Открыть панель</a>`] : []),
  ].join("\n");
}

export interface ScheduleRow {
  wipeAt: Date;
  kind: NoticeKind;
  note: string;
  promo: number | null;
}

export function scheduleText(rows: ScheduleRow[], z: Zone): string {
  const lines = [`📅 <b>Ближайшие вайпы</b> · ${e(z.label)}`, SEP];
  let prevWeek: string | null = null;
  for (const r of rows) {
    const p = zonedParts(r.wipeAt, z.tz);
    // Понедельник недели — разделитель между неделями.
    const monday = new Date(Date.UTC(p.year, p.month - 1, p.day - p.weekday)).toISOString().slice(0, 10);
    if (prevWeek !== null && monday !== prevWeek) lines.push("");
    prevWeek = monday;
    const parts = [`${NOTICE_KIND_ICON[r.kind]} <b>${fmtShort(r.wipeAt, z)}</b> · ${hm(r.wipeAt, z)}`, NOTICE_KIND_LABEL[r.kind]];
    if (r.promo) parts.push(`🎟 ${r.promo}%`);
    if (r.note) parts.push(r.note);
    lines.push(parts.join(" · "));
  }
  if (!rows.length) lines.push("<i>В ближайший месяц вайпов нет: проверь расписание в панели.</i>");
  if (rows.some((r) => r.promo)) lines.push("", "<i>🎟 — для этого вайпа при подтверждении создаётся промокод.</i>");
  return lines.join("\n");
}

export function testMenu(lines: string[]): string {
  return [
    "🧪 <b>Тестовый прогон</b>",
    SEP,
    "Какой вайп проверяем? Он «случится» через 2 минуты: придёт уведомление, как настоящее, затем отправка.",
    "",
    ...lines,
    "",
    "<i>Свои параметры: /test global 5 — глобальный через 5 минут.</i>",
  ].join("\n");
}

export const testUsage = () => "⚠️ Формат: <code>/test regular 5</code> или <code>/test global 5</code>\nМинуты — число от 1 до 1440.";

export function startup(next: { at: Date; kind: NoticeKind } | null, z: Zone, flags: { discord: boolean; vk: boolean; gs: boolean }, missing: string[], agenda: string | null, dryRun: boolean): string {
  const ok = (f: boolean) => (f ? "✅" : "❌");
  const lines = ["🟢 <b>Бот запущен</b>", SEP];
  if (next) lines.push("Ближайший вайп:", `${NOTICE_KIND_ICON[next.kind]} <b>${fmtDay(next.at, z)}</b> · <b>${hm(next.at, z)}</b> ${e(z.label)} · ${NOTICE_KIND_LABEL[next.kind]}`);
  lines.push("", `${ok(flags.discord)} Discord · ${ok(flags.vk)} ВКонтакте · ${ok(flags.gs)} gamestores`);
  if (agenda) lines.push(agenda);
  if (missing.length) lines.push(`⚠️ Не настроено в панели: ${missing.map(e).join(", ")}`);
  if (dryRun) lines.push("", "🧪 <b>Пробный режим включён</b> — наружу ничего не уходит.");
  return lines.join("\n");
}

export function promosOk(promos: { code: string; type?: string; amount?: number; dateEnd?: string; used?: number }[]): string {
  const lines = [`🎟 <b>Промокоды gamestores</b> · активных: ${promos.length}`, SEP];
  if (!promos.length) lines.push("<i>Список пуст.</i>");
  for (const p of promos.slice(0, 15)) {
    const what = p.type === "discount" ? `${p.amount}%` : p.type === "money" ? `${p.amount} на баланс` : p.type === "item" ? "товар" : String(p.amount ?? "");
    const bits = [`<code>${e(p.code)}</code>`, e(what)];
    if (p.dateEnd) bits.push(`до ${e(p.dateEnd)}`);
    if (p.used !== undefined && p.used !== null) bits.push(`использован ${e(p.used)}×`);
    lines.push(`• ${bits.join(" · ")}`);
  }
  if (promos.length > 15) lines.push(`<i>…и ещё ${promos.length - 15}</i>`);
  lines.push("", "✅ Ключи работают.");
  return lines.join("\n");
}

export const promosError = (reason: string) => `🎟 <b>Промокоды gamestores</b>\n${SEP}\n❌ Запрос не удался:\n${quote(e(clip(reason, 500)))}`;
export const promosNotConfigured = () => `🎟 <b>Промокоды gamestores</b>\n${SEP}\nНе заданы ID магазина и секретный ключ gamestores: их вводят в панели.`;

// ---------------------------------------------------------------- клавиатуры

const btn = (text: string, data: string): InlineButton => ({ text, callback_data: data });

export function mainKb(ev: NoticeEvent): InlineKeyboard {
  const rows: InlineButton[][] = [];
  if (!ev.confirmed) rows.push([btn("✅ Подтвердить", `ok|${ev.key}`)]);
  rows.push([btn("✏️ Изменить текст", `chg|${ev.key}`), btn("🚫 Не отправлять", `skip|${ev.key}`)]);
  return { inline_keyboard: rows };
}

export function templatesKb(ev: NoticeEvent, templates: NoticeTemplate[]): InlineKeyboard {
  return {
    inline_keyboard: [
      ...templates.map((t) => [btn(`${t.id === ev.templateId ? "● " : ""}${NOTICE_KIND_ICON[t.kind as NoticeKind]} ${t.title}`, `tpl|${ev.key}|${t.id}`)]),
      [btn("⬅️ Назад", `back|${ev.key}`)],
    ],
  };
}

export const skipConfirmKb = (ev: NoticeEvent): InlineKeyboard => ({
  inline_keyboard: [[btn("🚫 Да, не отправлять", `skipyes|${ev.key}`), btn("⬅️ Назад", `back|${ev.key}`)]],
});

export const retryKb = (ev: NoticeEvent): InlineKeyboard => ({ inline_keyboard: [[btn("🔁 Повторить неудавшиеся", `retry|${ev.key}`)]] });

const AGENDA_OFF = "🔕 Отключить уведомления";
export const agendaKb = (): InlineKeyboard => ({ inline_keyboard: [[btn(AGENDA_OFF, "agenda|off")]] });
export const reminderKb = (rem: NoticeReminder, day: string): InlineKeyboard => ({
  inline_keyboard: [[btn(rem.button, `rm|${rem.id}|${day}`)], [btn(AGENDA_OFF, "agenda|off")]],
});
export const testKb = (): InlineKeyboard => ({ inline_keyboard: [[btn("🟢 Обычный", "test|regular"), btn("🔴 Глобальный", "test|global")]] });
