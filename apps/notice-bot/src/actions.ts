import { NOTICE_ACTION_LABEL, prisma, type NoticeAction, type Prisma } from "@flamebot/core";
import { testReminder } from "./agenda.js";
import { runCheck } from "./check.js";
import { errorText, event, log } from "./events.js";
import { service } from "./service.js";

// Задания из панели. Панель не умеет ни публиковать, ни создавать промокоды, ни писать в Telegram,
// поэтому кладёт задание в NoticeAction, а бот выполняет его тем же кодом, что и кнопки в Telegram.

type Result = { text: string; ok: boolean; details?: Prisma.InputJsonValue };

const str = (v: unknown) => (typeof v === "string" ? v : "");

async function perform(a: NoticeAction): Promise<Result> {
  const args = (a.args ?? {}) as Record<string, unknown>;
  const by = a.byName ? `${a.byName} (панель)` : "панель";
  switch (a.kind) {
    case "event.confirm":
      return service.confirm(str(args.key), by);
    case "event.template":
      return service.pickTemplate(str(args.key), str(args.templateId), by);
    case "event.skip":
      return service.skip(str(args.key), by);
    case "event.retry":
      return service.retry(str(args.key));
    case "test.start": {
      const minutes = Number(args.minutes);
      return service.startTest(args.kind === "global" ? "global" : "regular", Number.isInteger(minutes) && minutes >= 1 && minutes <= 1440 ? minutes : 2);
    }
    case "reminder.test":
      return testReminder(str(args.id) || null);
    case "promos.list": {
      const list = await service.promos();
      if (!list) return { ok: false, text: "Не заданы ID магазина и секретный ключ gamestores" };
      return { ok: true, text: `Активных промокодов: ${list.length}`, details: list.slice(0, 50) as unknown as Prisma.InputJsonValue };
    }
    case "check": {
      const rows = await runCheck();
      const ok = rows.every((r) => r.ok !== false);
      return { ok, text: ok ? "Проверка пройдена" : "Есть проблемы", details: rows as unknown as Prisma.InputJsonValue };
    }
    default:
      return { ok: false, text: `Неизвестное задание «${a.kind}»` };
  }
}

const QUIET = new Set(["check", "promos.list"]);
let running = false;

export async function processActions(): Promise<void> {
  if (running) return;
  running = true;
  try {
    // Задания старше часа уже никому не нужны: панель давно показала, что бот не ответил.
    await prisma.noticeAction.updateMany({
      where: { status: { in: ["pending", "running"] }, createdAt: { lt: new Date(Date.now() - 3_600_000) } },
      data: { status: "error", result: "Бот не успел выполнить задание (был выключен?)", doneAt: new Date() },
    });
    const pending = await prisma.noticeAction.findMany({ where: { status: "pending" }, orderBy: { id: "asc" }, take: 10 });
    for (const a of pending) {
      // Забираем задание атомарно: второй процесс бота его не повторит.
      const { count } = await prisma.noticeAction.updateMany({ where: { id: a.id, status: "pending" }, data: { status: "running" } });
      if (count === 0) continue;
      let r: Result;
      try {
        r = await perform(a);
      } catch (err) {
        log.warn(`Задание из панели «${a.kind}» не выполнено`, err);
        r = { ok: false, text: errorText(err).slice(0, 500) };
      }
      await prisma.noticeAction.update({
        where: { id: a.id },
        data: { status: r.ok ? "done" : "error", result: r.text.slice(0, 1000), details: r.details, doneAt: new Date() },
      });
      if (!QUIET.has(a.kind)) {
        event("bot.panel_action", `Из панели (${a.byName ?? "?"}): ${NOTICE_ACTION_LABEL[a.kind] ?? a.kind} — ${r.text}`.slice(0, 1000), {
          level: r.ok ? "INFO" : "WARN",
          details: { kind: a.kind, args: a.args, ok: r.ok },
        });
      }
    }
  } finally {
    running = false;
  }
}
