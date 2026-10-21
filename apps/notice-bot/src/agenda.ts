import {
  NOTICE_KIND_LABEL,
  addDays,
  buildPromoSpec,
  defaultTemplateId,
  fmtPromoEnd,
  isoDay,
  noticeWipeOn,
  parseTime,
  prisma,
  zonedParts,
  zonedToDate,
  type CalendarDate,
  type NoticeKind,
  type NoticeReminder,
  type Prisma,
} from "@flamebot/core";
import { event, log } from "./events.js";
import * as msg from "./messages.js";
import { broadcast, clearMsgs, editText, serial } from "./service.js";
import { ctx } from "./state.js";

// Утренний план дня и напоминания с кнопкой. Что уже отправлено, хранится в NoticeDaily,
// поэтому перезапуск бота ничего не дублирует.

type Msgs = [string | number, number][];
interface ReminderState {
  done: boolean;
  next: number;
  msgs: Msgs;
}

const zone = (): msg.Zone => ({ tz: ctx().settings.timezone, label: ctx().settings.timezoneLabel });
const localDay = (d: Date): CalendarDate => {
  const p = zonedParts(d, ctx().settings.timezone);
  return { year: p.year, month: p.month, day: p.day };
};
const at = (day: CalendarDate, time: string) => zonedToDate(day, parseTime(time) ?? { hour: 0, minute: 0 }, ctx().settings.timezone);

async function getDaily<T>(key: string): Promise<T | null> {
  return ((await prisma.noticeDaily.findUnique({ where: { key } }))?.data ?? null) as T | null;
}
async function setDaily(key: string, data: unknown): Promise<void> {
  const json = data as Prisma.InputJsonValue;
  await prisma.noticeDaily.upsert({ where: { key }, create: { key, data: json }, update: { data: json } });
}

export const WEEKDAY_ARGS: Record<string, number> = {
  понедельник: 0, вторник: 1, среда: 2, четверг: 3, пятница: 4, суббота: 5, воскресенье: 6,
  пн: 0, вт: 1, ср: 2, чт: 3, пт: 4, сб: 5, вс: 6,
  monday: 0, tuesday: 1, wednesday: 2, thursday: 3, friday: 4, saturday: 5, sunday: 6,
};

// Подстановки в пунктах плана: {wipe_time}, {wipe_kind}, {promo} — по вайпу этого дня.
export async function dayContext(day: CalendarDate): Promise<Record<string, string>> {
  const c = ctx();
  const wipe = noticeWipeOn(c.rules, c.settings.timezone, day);
  if (!wipe) return { wipe_time: "—", wipe_kind: "—", promo: "—" };
  // Если текст уже меняли — берём выбранный, а не текст по умолчанию.
  const ev = await prisma.noticeEvent.findUnique({ where: { key: wipe.key } });
  const tplId = ev?.templateId ?? defaultTemplateId(wipe.rule, wipe.kind);
  const tpl = tplId ? c.templates.get(tplId) : undefined;
  let promo = "не нужен";
  if (tpl?.promoAmount) {
    const spec = buildPromoSpec(c.settings, tpl.promoAmount, wipe.wipeAt);
    promo = `${spec.code} · ${spec.amount}% · до ${fmtPromoEnd(spec.dateEnd)} ${c.settings.timezoneLabel}`;
  }
  return { wipe_time: msg.hm(wipe.wipeAt, zone()), wipe_kind: NOTICE_KIND_LABEL[(tpl?.kind ?? wipe.kind) as NoticeKind], promo };
}

// Когда придёт ближайший план дня.
export function nextMorning(now: Date): Date | null {
  const c = ctx();
  const today = localDay(now);
  for (let i = 0; i < 8; i++) {
    const day = addDays(today, i);
    const wd = zonedParts(at(day, "12:00"), c.settings.timezone).weekday;
    if (!c.agenda.get(wd)?.length) continue;
    const slot = at(day, c.settings.agendaSendAt);
    if (slot > now) return slot;
  }
  return null;
}

export async function planText(arg: string, now: Date): Promise<string> {
  const c = ctx();
  const today = localDay(now);
  const wdToday = zonedParts(now, c.settings.timezone).weekday;
  if (!arg) {
    const items = c.agenda.get(wdToday);
    return items?.length ? msg.agendaText(now, zone(), items, c.settings.agendaGreeting, await dayContext(today)) : msg.agendaNone(wdToday, true);
  }
  const wd = WEEKDAY_ARGS[arg.trim().toLowerCase()];
  if (wd === undefined) return "⚠️ Укажите день недели: <code>/plan вторник</code>";
  const items = c.agenda.get(wd);
  if (!items?.length) return msg.agendaNone(wd, false);
  // Ближайший такой день — для подстановок.
  return msg.agendaForDay(wd, items, await dayContext(addDays(today, (wd - wdToday + 7) % 7)));
}

// Включает или выключает план дня и напоминания. Возвращает, изменилось ли состояние.
export function setAgendaEnabled(value: boolean, by: string): Promise<boolean> {
  return serial(async () => {
    const changed = ctx().settings.agendaEnabled !== value;
    await prisma.noticeSettings.update({ where: { id: 1 }, data: { agendaEnabled: value } });
    ctx().settings.agendaEnabled = value; // до перечитывания настроек
    if (changed) event(value ? "agenda.on" : "agenda.off", `${by} ${value ? "включил" : "отключил"} план дня и напоминания`);
    return changed;
  });
}

export async function agendaTick(now: Date): Promise<void> {
  // Выключено: ничего не отправляем и ничего не помечаем — после включения всё продолжится как обычно.
  if (!ctx().settings.agendaEnabled) return;
  await morning(now);
  await reminders(now);
}

async function morning(now: Date): Promise<void> {
  const c = ctx();
  const day = localDay(now);
  const items = c.agenda.get(zonedParts(now, c.settings.timezone).weekday);
  if (!items?.length) return;
  const slot = at(day, c.settings.agendaSendAt);
  const key = `agenda:${isoDay(day)}`;
  const late = now.getTime() - slot.getTime();
  if (late < 0 || late > c.settings.agendaGraceMinutes * 60_000 || (await getDaily(key))) return;
  const sent = await broadcast(msg.agendaText(now, zone(), items, c.settings.agendaGreeting, await dayContext(day)), msg.agendaKb());
  // Если Telegram никому не доставил — повторим на следующем такте, пока не истекло допустимое опоздание.
  if (sent.length) {
    await setDaily(key, { sent: true });
    event("agenda.sent", `План дня на ${isoDay(day)} отправлен`);
  }
}

const reminderKey = (rem: NoticeReminder, day: string) => `remind:${rem.id}:${day}`;
const fresh = (): ReminderState => ({ done: false, next: 0, msgs: [] });

async function reminders(now: Date): Promise<void> {
  const c = ctx();
  const dayCal = localDay(now);
  const day = isoDay(dayCal);
  const wd = zonedParts(now, c.settings.timezone).weekday;
  for (const rem of c.reminders) {
    if (!rem.days.includes(wd)) continue;
    const state = (await getDaily<ReminderState>(reminderKey(rem, day))) ?? fresh();
    if (state.done) continue;
    const slots = rem.times.map((t) => at(dayCal, t));
    const due = slots.map((s, i) => ({ s, i })).filter(({ s, i }) => i >= state.next && s <= now);
    if (!due.length) continue;
    // Пропущено несколько слотов — напоминаем один раз, по последнему.
    const chosen = due[due.length - 1]!.i;
    if (now.getTime() - slots[chosen]!.getTime() > rem.graceMinutes * 60_000) {
      state.next = chosen + 1; // слишком поздно — молча пропускаем этот слот
      await setDaily(reminderKey(rem, day), state);
      continue;
    }
    await sendReminder(rem, day, state, chosen, false);
  }
}

async function sendReminder(rem: NoticeReminder, day: string, state: ReminderState, index: number, isTest: boolean): Promise<boolean> {
  // Живая кнопка должна быть одна — на последнем напоминании.
  await clearMsgs(state.msgs);
  const following = rem.times[index + 1] ?? null;
  const sent = await broadcast(msg.reminderText(rem, index + 1, rem.times.length, following, isTest), msg.reminderKb(rem, day));
  if (!sent.length) return false;
  state.next = index + 1;
  state.msgs = sent;
  await setDaily(reminderKey(rem, day), state);
  return true;
}

// Тестовое напоминание: настоящая кнопка, но состояние отдельное и на расписание не влияет.
export function testReminder(id: string | null): Promise<{ ok: boolean; text: string }> {
  return serial(async () => {
    const all = ctx().reminders;
    const rem = id ? all.find((r) => r.id === id) : all[0];
    if (!rem) return { ok: false, text: all.length ? `Нет такого напоминания. Доступные: ${all.map((r) => r.id).join(", ")}` : "Напоминаний нет: добавь их в панели" };
    const ok = await sendReminder(rem, "test", fresh(), 0, true);
    return ok ? { ok, text: `Тестовое напоминание «${rem.title}» отправлено в Telegram` } : { ok, text: "Telegram никому не доставил напоминание" };
  });
}

// Нажали «Готово»: остальные напоминания этого дня не придут.
export function confirmReminder(id: string, day: string, by: string): Promise<{ rem: NoticeReminder | null; already: boolean }> {
  return serial(async () => {
    const rem = ctx().reminders.find((r) => r.id === id) ?? null;
    if (!rem) return { rem: null, already: false };
    const key = reminderKey(rem, day);
    const state = (await getDaily<ReminderState>(key)) ?? fresh();
    const already = state.done;
    state.done = true;
    await setDaily(key, state);
    const text = msg.reminderDone(rem, msg.hm(new Date(), zone()), zone(), day === "test", by);
    for (const [chat, mid] of state.msgs) await editText(chat, mid, text, null).catch((err) => log.info(`Напоминание не обновилось: ${String(err)}`));
    if (!already && day !== "test") event("agenda.done", `Напоминание «${rem.title}» отмечено: ${by}`);
    return { rem, already };
  });
}
