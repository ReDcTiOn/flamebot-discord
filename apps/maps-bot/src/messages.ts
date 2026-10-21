import { MAPS_CYCLE_STATUS, MAPS_POOL_STATUS, MAPS_SLOT_STATUS, monumentChecklist, type MapInfo } from "@flamebot/core";
import type { InlineButton, InlineKeyboard, ReplyKeyboard } from "./clients/telegram.js";

// Тексты сообщений бота в Telegram (HTML) и клавиатуры. Функции чистые: принимают сырые данные
// без экранирования и возвращают готовую разметку. Приёмы оформления:
//   • ссылки встроены в текст (<a>), а не вставлены голым адресом;
//   • второстепенное в цитате <blockquote>, длинные списки в сворачиваемой цитате;
//   • значения, которые удобно копировать (seed, имена файлов), в <code>.

// --------------------------------------------------------------------------- кирпичики
export const e = (x: unknown) => String(x).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
const attr = (x: unknown) => e(x).replaceAll('"', "&quot;");
export const link = (url: unknown, text: string) => `<a href="${attr(url)}">${e(text)}</a>`;
export const code = (x: unknown) => `<code>${e(x)}</code>`;
// Закрывающий тег без атрибутов, иначе Telegram отклонит разметку.
export const quote = (body: string, expandable = false) => `${expandable ? "<blockquote expandable>" : "<blockquote>"}${body}</blockquote>`;

export function fname(url: string | null | undefined): string {
  const last = (url ?? "").split("/").pop() ?? "";
  try {
    return decodeURIComponent(last);
  } catch {
    return last;
  }
}

// HTML-сообщение без тегов: запасной вариант, если Telegram не принял разметку.
export const plain = (text: string) =>
  text
    .replace(/<[^>]+>/g, "")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&amp;", "&");

const badges = (staging = false, blueprints = false) => (staging ? " · 🧪 <b>STAGING</b>" : "") + (blueprints ? " · 🧹 <b>ГЛОБАЛЬНЫЙ</b>" : "");
const g = (n: number) => String(Math.round(n * 10) / 10);

export const actionResult = (emoji: string, text: string) => `${emoji} <b>${e(text)}</b>`;

// --------------------------------------------------------------------------- цикл вайпа
export function cycleStarted(wipe: string, staging: boolean, blueprints: boolean, plan: string[], nServers: number, sendAt: string, auto: boolean, panelUrl: string | null): string {
  return (
    `🚀 <b>Генерация карт запущена</b>\nВайп <b>${e(wipe)}</b>${badges(staging, blueprints)}\n\n` +
    quote(
      `🗺 Пул: <b>${e(plan.join(" · "))}</b>\n🖥 Серверов: <b>${nServers}</b>\n📨 Анонс в Discord: <b>${e(sendAt)}</b>` +
        (auto ? "\n🤖 Автоподбор карт: <b>включён</b>" : ""),
    ) +
    (panelUrl ? `\n🖥 ${link(panelUrl, "Открыть в панели")}` : "")
  );
}

export const announceOverdue = (sendAt: string, pending: string[]) =>
  `⏰ <b>Время анонса наступило</b> · ${e(sendAt)}\nКарты не готовы: <b>${e(pending.join(", "))}</b>\n<i>Как только все будут подтверждены, анонс уйдёт сразу.</i>`;

export const poolExhausted = (size: number, count: number) => `📦 <b>Пул ${size} закончился</b>\nГенерирую новую пачку: <b>${count}</b> шт.`;

// --------------------------------------------------------------------------- карточка карты
export interface Card {
  title: string;
  wipe: string;
  status: string; // ready | uploading | uploaded | error | waiting
  staging: boolean;
  blueprints: boolean;
  manual: boolean;
  seed: number | null;
  size: number;
  config: string;
  attempt: number;
  info: MapInfo;
  viewUrl: string | null;
  cdnUrl: string | null;
  error: string | null;
  spare: number;
  coming: number;
  panelOn: boolean;
  panelSynced: boolean;
  panelNote: string | null;
  panelHours: number;
  score: number | null;
  scoreParts: [number, number, number, number] | null; // РТ, расстановка, рельеф, насыщенность
}

function head(c: Card): string {
  const line3 = c.manual
    ? `✋ <b>Загружена вручную</b> · ${code(c.config)}`
    : `🎲 ${code(c.seed)} · <b>${c.size}</b> · ${code(c.config)}` + (c.attempt > 1 ? ` · попытка ${c.attempt}` : "");
  return `🗺 <b>${e(c.title)}</b>${badges(c.staging, c.blueprints)}\n<i>вайп ${e(c.wipe)}</i>\n${line3}`;
}

function stats(info: MapInfo): string {
  const v = (k: string) => (info[k] === null || info[k] === undefined ? "—" : String(info[k]));
  const total = info.totalMonuments ?? (info.monuments ?? []).length;
  const rows = [`📊 Монументов <b>${total}</b> · суша <b>${v("landPercentageOfMap")}%</b>`, `🏝 острова ${v("islands")} · ⛰ горы ${v("mountains")} · 🌊 реки ${v("rivers")}`];
  const b = (info.biomePercentages ?? {}) as Record<string, number | null>;
  const biomes = (
    [
      ["s", "❄️"],
      ["d", "🏜"],
      ["f", "🌲"],
      ["t", "🌾"],
      ["j", "🌴"],
    ] as const
  )
    .filter(([k]) => b[k] !== null && b[k] !== undefined)
    .map(([k, icon]) => `${icon}${Math.round(b[k]!)}%`);
  if (biomes.length) rows.push("🌿 " + biomes.join("  "));
  return quote(rows.join("\n"));
}

export function mapCard(c: Card): string {
  const h = head(c);
  if (c.status === "ready") {
    const rows = monumentChecklist(c.info.monuments);
    const missing = rows.filter((r) => !r.present).map((r) => r.name);
    const present = rows.length - missing.length;
    const rt = missing.length
      ? `🏛 <b>РТ: ${present} из ${rows.length}</b>\n❌ <i>Нет:</i> ${e(missing.join(", "))}`
      : `🏛 <b>РТ: все ${rows.length} на месте</b> ✅`;
    const lines = rows.map((r) => `${r.present ? "✅" : "❌"} ${e(r.name)}`);
    const tail: string[] = [];
    if (c.score !== null && c.scoreParts) {
      const [a, b, t, x] = c.scoreParts;
      tail.push(`🏅 Оценка <b>${g(c.score)}</b>/100 · <i>РТ ${g(a)} · расстановка ${g(b)} · рельеф ${g(t)} · насыщенность ${g(x)}</i>`);
    }
    if (c.viewUrl) tail.push(`🔗 ${link(c.viewUrl, "Открыть на RustMaps")}`);
    tail.push(`📦 В запасе: <b>${c.spare}</b> готовых` + (c.coming ? ` · ещё ${c.coming} генерируются` : ""));
    if (c.error) tail.push(`⚠️ <i>${e(c.error)}</i>`);
    return [h, "", stats(c.info), rt, quote(lines.join("\n"), true), ...tail].join("\n");
  }
  if (c.status === "uploading") return `${h}\n\n⏳ <b>Загружаю на S3…</b>\n<i>Скачиваю файл с RustMaps и проверяю ссылку на CDN</i>`;
  if (c.status === "uploaded") {
    const rows = [`📄 ${code(fname(c.cdnUrl))}`, `📥 ${link(c.cdnUrl, "Скачать")}`];
    if (c.viewUrl && c.viewUrl !== c.cdnUrl) rows[rows.length - 1] += ` · 🔗 ${link(c.viewUrl, "Страница карты")}`;
    if (c.panelOn) {
      rows.push(
        c.panelNote
          ? `🖥 Панель: ${c.panelSynced ? "✅" : "⚠️"} ${e(c.panelNote)}`
          : `🖥 Панель: <i>ссылка запишется после вашего подтверждения (запрос за ${c.panelHours} ч до вайпа)</i>`,
      );
    }
    return `${h}\n\n✅ <b>Подтверждена и загружена</b>\n${quote(rows.join("\n"))}`;
  }
  if (c.status === "error") return `${h}\n\n❌ <b>Не удалось получить карту</b>\n${quote(e(c.error ?? "ошибка"))}`;
  return `${h}\n\n⏳ <b>Жду готовую карту из пула…</b>`;
}

export const photoCaption = (title: string, seed: unknown, size: number) => `<b>${e(title)}</b> · 🎲 ${code(seed)} · ${size}`;

// --------------------------------------------------------------------------- пометки на старых карточках
export const noteSkipped = (seed: unknown) => `🔄 <i>Карта ${code(seed)} пропущена</i>`;
export const noteRegen = () => "🔁 <i>Запрошена новая карта</i>";
export const noteBack = (prev: unknown, cur: unknown) => `◀️ <i>Вернулся к карте ${code(prev)}. Эта (${code(cur)}) отложена и вернётся по «Заменить».</i>`;
export const noteManualReplaced = () => "✋ <i>Заменена вручную загруженной картой (ниже)</i>";
export const noteManualReleased = () => "↩ <i>Ручная карта снята</i>";
export const noteAllReplaced = () => "🔄 <i>Заменена (замена всех карт)</i>";
export const noteAutoReplaced = () => "🤖 <i>Заменена автоподбором</i>";
export const reopened = () => "↩ <b>Подтверждения сняты</b>\n<i>Автоотправка в Discord отменена. Выберите карты заново.</i>";

// --------------------------------------------------------------------------- Discord
export function discordPrompt(wipe: string, rows: [string, boolean, string][], status: string, sendAt: string, sendFuture: boolean, extra = ""): string {
  const lines = rows.map(([title, manual, url]) => `<b>${e(title)}</b>${manual ? " ✋" : ""} — ${link(url, fname(url))}`);
  const out = [`📨 <b>Анонс в Discord</b>\nВайп <b>${e(wipe)}</b> · все карты подтверждены ✅\n`, quote(lines.join("\n"))];
  if (status === "scheduled") out.push(sendFuture ? `⏰ Уйдёт автоматически: <b>${e(sendAt)}</b>` : "⏰ <i>Время анонса уже наступило, отправляю…</i>");
  else if (status === "awaiting_discord") out.push("🔕 <b>Автоотправка выключена.</b> Отправить анонс?");
  if (extra) out.push("\n" + extra);
  return out.join("\n");
}

export const discordSent = () => "📨 <b>Отправлено в Discord</b> ✅";
export const discordSkipped = () => "✖ <b>В Discord не отправляю</b>\n<i>Вернуть вопрос: /discord</i>";
export const discordFailed = (err: string) => `❌ <b>Не отправилось</b>\n${quote(e(err))}`;
export const resendPick = () => "📨 <b>Повторная отправка анонса</b>\nАнонс какого вайпа отправить ещё раз?";
export const resendNone = () => "📨 Отправленных анонсов пока нет.";
export const resendAsk = (wipe: string, hint: string) =>
  `📨 <b>Отправить анонс ещё раз?</b>\nВайп <b>${e(wipe)}</b>\n\n` +
  quote(`🔗 Webhook: ${code(hint)}`) +
  "\n<i>Предыдущее сообщение в Discord не удаляется. Если вебхук был неверный, сначала замените его в панели («Подключение»).</i>";
export const resendDone = (hint: string) => `📨 <b>Анонс отправлен повторно</b>\n${quote("🔗 " + code(hint))}`;

// --------------------------------------------------------------------------- изменение карт (/reset)
export const resetPick = () => "♻️ <b>Изменить карты</b>\nДля какого вайпа?";
export const resetNone = () => "♻️ Нет вайпов, в которых можно менять карты (анонс уже отправлен или генерация не начата).";

export function resetMenu(wipe: string, status: string, slots: [string, boolean, string][]): string {
  const rows = slots.map(([t, manual, st]) => `<b>${e(t)}</b>${manual ? " ✋" : ""} — ${MAPS_SLOT_STATUS[st] ?? e(st)}`).join("\n");
  return (
    `♻️ <b>Изменить карты</b> · вайп <b>${e(wipe)}</b>\n<i>${MAPS_CYCLE_STATUS[status] ?? e(status)}</i>\n\n` +
    quote(rows) +
    "\n↩ <b>Снять подтверждения</b>: те же карты, выбрать заново\n🔄 <b>Заменить все</b>: следующие карты из пула"
  );
}

export const resetReplaceConfirm = () =>
  "🔄 <b>Заменить все карты этого вайпа?</b>\nПодтверждённые тоже заменятся, а автоотправка в Discord и запись в панель будут сброшены.\n<i>Если готовых карт в запасе не хватит, потратятся новые генерации.</i>";

// --------------------------------------------------------------------------- Pterodactyl
export function panelAsk(wipe: string, autoAt: string, blueprints: boolean, rows: [string, string | null][]): string {
  const mode = blueprints
    ? "🧹 <b>Глобальный вайп</b>: «Wipe Blueprints» будет <b>ВКЛЮЧЁН</b> (рецепты сбросятся)"
    : "🗓 <b>Обычный вайп</b>: «Wipe Blueprints» будет <b>ВЫКЛЮЧЕН</b> (рецепты сохранятся)";
  const lines = rows.map(([t, name]) => (name ? `<b>${e(t)}</b> — ${code(name)}` : `<b>${e(t)}</b> — ⚠️ карта не подтверждена`)).join("\n");
  return `🖥 <b>Обновить ссылки в панели?</b>\nВайп <b>${e(wipe)}</b>\n\n${mode}\n\n${quote(lines)}\n<i>Не отвечу — напомню позже, а в <b>${e(autoAt)}</b> обновлю сам.</i>`;
}

export function panelResult(auto: boolean, wipe: string, rows: [string, boolean | null, string][], ok: boolean): string {
  const h = auto ? "🤖 <b>Вы не ответили — обновил ссылки сам</b>" : ok ? "🖥 <b>Ссылки в панели обновлены</b>" : "⚠️ <b>Ссылки в панели: есть проблемы</b>";
  const lines = rows.map(([t, good, note]) => `<b>${e(t)}</b> — ${good ? "✅" : "⚠️"} ${e(note)}`).join("\n");
  const tail = ok ? "" : auto ? "\n⚠️ <i>Есть проблемы — проверьте панель вручную.</i>" : "\n⚠️ <i>Есть проблемы, напомню позже.</i>";
  return `${h}\nВайп <b>${e(wipe)}</b>\n\n${quote(lines)}${tail}`;
}

export const panelSkipped = () => "✖ <b>Ссылки в панели не обновляю</b>\n<i>Вы поставите их сами. Напоминаний больше не будет.</i>";
export const panelReminderOld = () => "↻ <i>Напоминание отправлено ниже</i>";
export const panelUnconfigured = () => "🖥 Pterodactyl не настроен: нужны адрес панели, ключ ptlc_ и идентификаторы серверов (панель бота → «Подключение» и «Серверы»).";

export function panelStatus(servers: [string, string | null, [string, boolean, string][]][]): string {
  const blocks = servers.map(([title, err, tasks]) => {
    const body = err
      ? `❌ ${e(err)}`
      : !tasks.length
        ? "<i>задач вайпа нет</i>"
        : tasks.map(([run, bp, name]) => `▫️ ${e(run)} · ${bp ? "🧹 рецепты СБРОС" : "🗓 рецепты сохраняются"}\n    📄 ${code(name)}`).join("\n");
    return `<b>${e(title)}</b>\n${quote(body)}`;
  });
  return "🖥 <b>Задачи вайпа в панели</b>\n\n" + blocks.join("\n");
}

// --------------------------------------------------------------------------- глобальный вайп
export const globalMenu = () => "🧹 <b>Глобальные вайпы</b>\nГлобальный вайп сбрасывает рецепты («Wipe Blueprints» в панели).\n<i>Нажмите на вайп, чтобы переключить признак.</i>";
export const globalNone = () => "🧹 Нет предстоящих вайпов с запущенной генерацией.";

// --------------------------------------------------------------------------- справка: /status, /next
export interface CycleView {
  wipe: string;
  staging: boolean;
  blueprints: boolean;
  id: string;
  status: string;
  slots: [string, boolean, string, number][];
  pool: Record<string, number>;
}

export function statusView(cycles: CycleView[], missing: string[]): string {
  const warn = missing.length ? `⚠️ <b>Не настроено:</b> ${e(missing.join(", "))}\n\n` : "";
  if (!cycles.length) return `${warn}📋 Циклов пока нет.`;
  const blocks = cycles.map((c) => {
    const rows = c.slots.map(([t, manual, st, att]) => `<b>${e(t)}</b>${manual ? " ✋" : ""} — ${MAPS_SLOT_STATUS[st] ?? e(st)}` + (att > 1 ? ` · попытка ${att}` : ""));
    const bySize = new Map<string, string[]>();
    for (const [key, n] of Object.entries(c.pool).sort()) {
      const [size, st] = key.split(":") as [string, string];
      bySize.set(size, [...(bySize.get(size) ?? []), `${MAPS_POOL_STATUS[st] ?? st} ${n}`]);
    }
    if (bySize.size) rows.push("📦 Пул " + [...bySize].map(([sz, v]) => `${sz}: ${v.join(", ")}`).join("; "));
    return `<b>${e(c.wipe)}</b>${badges(c.staging, c.blueprints)}\n${code(c.id)} · ${MAPS_CYCLE_STATUS[c.status] ?? e(c.status)}\n${quote(rows.join("\n"), true)}`;
  });
  return `${warn}📋 <b>Состояние</b>\n\n` + blocks.join("\n");
}

export interface NextView {
  wipe: string;
  servers: number[];
  staging: boolean;
  blueprints: boolean;
  gen: string;
  send: string;
  panel: string | null;
}

export function nextView(items: NextView[]): string {
  if (!items.length) return "🗓 Ближайших вайпов нет: проверьте расписание в панели.";
  const blocks = items.map((it) => {
    const rows = [`🚀 Генерация: ${e(it.gen)}`, `📨 Анонс в Discord: ${e(it.send)}`];
    if (it.panel) rows.push(`🖥 Запрос по панели: ${e(it.panel)}`);
    return `<b>${e(it.wipe)}</b>${badges(it.staging, it.blueprints)}\n<i>серверы ${e(it.servers.join(", "))}</i>\n${quote(rows.join("\n"))}`;
  });
  return "🗓 <b>Ближайшие вайпы</b>\n\n" + blocks.join("\n");
}

// --------------------------------------------------------------------------- команды и диалоги
export function helpText(panelUrl: string | null): string {
  return (
    "🛠 <b>Бот карт FlameRust</b>\n\n" +
    "<b>Вайпы</b>\n/next — ближайшие вайпы и расписание\n/status — состояние карт и пула\n/gen — начать генерацию на вайп заранее\n/global — глобальный или обычный вайп\n\n" +
    "<b>Карты</b>\n/reset — изменить карты: снять подтверждения или заменить все\n/upload — добавить карту вручную\n/cancel — отменить добавление\n\n" +
    "<b>Discord и панель</b>\n/discord — вернуть вопрос про отправку\n/resend — отправить анонс повторно\n/panel — задачи вайпа в панели\n/auto — автоподбор карт: включить или выключить\n\n" +
    "<i>Кнопки внизу дублируют «Добавить карту» и «Изменить карты». Всё это же есть в веб-панели</i>" +
    (panelUrl ? `: ${link(panelUrl, "открыть")}` : ".")
  );
}

export const genPick = () => "🚀 <b>Запустить генерацию заранее</b>\nНа какой вайп? <i>Анонс в Discord всё равно уйдёт в назначенное время.</i>";
export const genNone = () => "🚀 Для ближайших вайпов генерация уже запущена.";
export const uploadPick = () => "📎 <b>Добавить карту вручную</b>\nНа какой сервер загружаем?";
export const uploadNone = () => "📎 Сейчас нет вайпов, в которые можно добавить карту. Они появляются, когда стартует генерация (или после /gen).";
export const uploadPrompt = (label: string) =>
  `📎 <b>Загрузка карты</b>\nСервер: <b>${e(label)}</b>\n\nПришлите <b>прямую ссылку</b> на .map. Второй ссылкой через пробел можно добавить страницу карты для кнопки «Посмотреть».\n` +
  quote("Файлом тоже можно, но не больше 20 МБ: это лимит Telegram для ботов. Если карта тяжелее, присылайте ссылку.");
export const uploadTooBig = () => "⚠️ Telegram не даёт боту скачивать файлы больше 20 МБ. Пришлите прямую ссылку на карту.";
export const uploadNoLink = () => "🔗 Не вижу ссылки. Пришлите прямую ссылку на .map или файл (до 20 МБ).";
export const uploadDownloading = () => "⏳ <b>Скачиваю…</b>";
export const uploadDownloadFailed = (err: string) => `❌ <b>Не получилось скачать</b>\n${quote(e(err))}\n<i>Пришлите другую ссылку или /cancel.</i>`;
export const uploadAskView = () => "✅ <b>Файл получен</b>\nПришлите ссылку на страницу карты (для кнопки «Посмотреть», например на CobaltMaps) или нажмите «Без ссылки».";
export const uploadViewNoLink = () => "🔗 Не вижу ссылки. Пришлите ссылку или нажмите «Без ссылки».";
export const uploadProgress = () => "⏳ <b>Загружаю карту на S3…</b>";
export const uploadDone = () => "✅ <b>Карта загружена</b>\n<i>Карточка ниже.</i>";
export const uploadFailed = (err: string) => `❌ <b>Не удалось загрузить карту</b>\n${quote(e(err))}`;
export const cancelled = () => "✖ Отменено";

// --------------------------------------------------------------------------- автоподбор карт
export const autoMenu = (enabled: boolean) =>
  `🤖 <b>Автоподбор карт</b>\nСтатус: <b>${enabled ? "включён ✅" : "выключен"}</b>\n\n` +
  quote(
    "Бот сам выбирает лучшие карты из пула и показывает набор целиком. Его можно подтвердить одной кнопкой, перевыбрать или открыть карточки серверов («Выбрать самому»), где карту на любом сервере можно заменить, вернуть или загрузить свою.",
  ) +
  "\n<i>Для нового вайпа автоподбор запустится сам, пока он включён. Для вайпа, где генерация уже идёт, нажмите кнопку с датой ниже.</i>";

export interface ProposalRow {
  title: string;
  seed: number | null;
  size: number;
  score: number | null;
  present: number;
  of: number;
  missing: string[];
  view: string | null;
}

export function autoProposal(wipe: string, rows: ProposalRow[], errors: [string, string][]): string {
  const blocks = rows.map((r) => {
    const lines = [
      `<b>${e(r.title)}</b>`,
      `🎲 ${code(r.seed)} · ${r.size}` + (r.score !== null ? ` · ⭐ <b>${g(r.score)}</b>/100` : ""),
      `🏛 РТ ${r.present}/${r.of}` + (r.missing.length ? ` · ❌ <i>нет:</i> ${e(r.missing.slice(0, 3).join(", "))}` : " ✅"),
    ];
    if (r.view) lines.push(`🔗 ${link(r.view, "Открыть на RustMaps")}`);
    return lines.join("\n");
  });
  blocks.push(...errors.map(([t, err]) => `<b>${e(t)}</b>\n⚠️ <i>${e(err)}</i>`));
  return `🤖 <b>Автоподбор карт</b>\nВайп <b>${e(wipe)}</b> · лучшие из пула по оценке\n\n` + quote(blocks.join("\n\n")) + "\n<i>Оценка из 100: РТ, расстановка, рельеф, насыщенность (веса — в панели).</i>";
}

export const autoWaiting = () => "🤖 <b>Автоподбор карт</b>\n⏳ <b>Генерирую новую пачку…</b>\n<i>Покажу новый набор, как только карты будут готовы.</i>";
export const autoManualDone = () => "✋ <b>Ручной выбор</b>\n<i>Карточки серверов ниже: подтверждайте, заменяйте или загружайте свои.</i>";
export const autoConfirmed = (n: number) => `✅ <b>Карты подтверждены</b>\n<i>Загружаю на S3: ${n}. Карточки серверов ниже.</i>`;

// =========================================================================== клавиатуры
export const BTN_ADD = "➕ Добавить карту";
export const BTN_RESET = "♻️ Изменить карты";

const b = (text: string, data: string): InlineButton => ({ text, callback_data: data });
const kb = (...rows: InlineButton[][]): InlineKeyboard => ({ inline_keyboard: rows });

export const kbMainReply = (): ReplyKeyboard => ({ keyboard: [[{ text: BTN_ADD }, { text: BTN_RESET }]], resize_keyboard: true, is_persistent: true });
export const kbCancel = (text = "✖ Отмена") => kb([b(text, "mc:cancel")]);
export const kbPick = (targets: [string | number, string][], prefix: string, cancelText = "✖ Отмена") =>
  kb(...targets.map(([id, label]) => [b(label, `${prefix}:${id}`)]), [b(cancelText, "mc:cancel")]);

export function kbCardReady(slotId: number, prevSeed: number | null): InlineKeyboard {
  const rows = [[b("✅ Подтвердить", `ap:${slotId}`), b("🔄 Заменить", `rr:${slotId}`)]];
  if (prevSeed !== null) rows.push([b(`◀️ Назад (${prevSeed})`, `bk:${slotId}`)]);
  rows.push([b("📎 Загрузить свою", `mu:${slotId}`)]);
  return kb(...rows);
}

export const kbCardError = (slotId: number) => kb([b("🔁 Сгенерировать заново", `rr:${slotId}`)], [b("📎 Загрузить свою", `mu:${slotId}`)]);
export const kbDiscordPrompt = (cycleId: string) => kb([b("📤 Отправить сейчас", `dc:now:${cycleId}`)], [b("✖ Не отправлять", `dc:no:${cycleId}`)]);
export const kbResendConfirm = (cycleId: string) => kb([b("📨 Да, отправить", `rdc:${cycleId}`)], [b("✖ Отмена", "mc:cancel")]);
export const kbPanelAsk = (cycleId: string) => kb([b("🖥 Обновить ссылки", `pn:ok:${cycleId}`)], [b("✖ Сделаю сам", `pn:no:${cycleId}`)]);
export const kbPanelNow = (targets: [string, string][]) => (targets.length ? kb(...targets.map(([id, label]) => [b(`🖥 Записать ссылки: ${label}`, `pn:ok:${id}`)])) : null);
export const kbResetMenu = (cycleId: string) => kb([b("↩ Снять подтверждения", `ru:${cycleId}`)], [b("🔄 Заменить все карты", `rn:${cycleId}`)], [b("✖ Отмена", "mc:cancel")]);
export const kbReplaceConfirm = (cycleId: string) => kb([b("Да, заменить все", `rnc:${cycleId}`)], [b("✖ Отмена", "mc:cancel")]);
export const kbSkipView = () => kb([b("Без ссылки", "mv:skip")], [b("✖ Отмена", "mc:cancel")]);
export const kbAutoProposal = (cycleId: string) =>
  kb([b("✅ Подтвердить все", `ac:${cycleId}`)], [b("🔄 Перевыбрать автоматически", `ar:${cycleId}`)], [b("✋ Выбрать самому", `am:${cycleId}`)]);

export function kbAutoMenu(enabled: boolean, targets: [string, string][]): InlineKeyboard {
  return kb(
    [b(enabled ? "⏸ Выключить автоподбор" : "▶️ Включить автоподбор", "at:toggle")],
    ...targets.map(([id, label]) => [b(`🤖 Подобрать: ${label}`, `au:${id}`)]),
    [b("✖ Закрыть", "mc:cancel")],
  );
}

export const kbGlobalList = (targets: [string, string][]) => kbPick(targets, "gb", "✖ Закрыть");
