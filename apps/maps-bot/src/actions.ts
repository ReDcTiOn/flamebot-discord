import { MAPS_ACTION_LABEL, prisma, type MapsAction, type Prisma } from "@flamebot/core";
import { runCheck } from "./check.js";
import { errorText, event, log } from "./events.js";
import { service } from "./service.js";

// Задания из панели. Панель не умеет ни генерировать, ни загружать карты, ни писать в Telegram,
// поэтому кладёт задание в MapsAction, а бот выполняет его тем же кодом, что и кнопки в Telegram.

type Result = string | { text: string; details?: Prisma.InputJsonValue; ok?: boolean };

const str = (v: unknown) => (typeof v === "string" ? v : "");
const int = (v: unknown) => (typeof v === "number" && Number.isInteger(v) ? v : -1);

async function perform(a: MapsAction): Promise<Result> {
  const args = (a.args ?? {}) as Record<string, unknown>;
  const cycleId = str(args.cycleId);
  const slotId = int(args.slotId);
  switch (a.kind) {
    case "gen.start":
      return service.startWipe(str(args.wipeId));
    case "slot.approve":
      return service.approve(slotId);
    case "slot.reroll":
      return service.reroll(slotId);
    case "slot.back":
      return service.goBack(slotId);
    case "slot.manual":
      return service.manualFromUrl(slotId, str(args.url), str(args.viewUrl) || null);
    case "cycle.unconfirm":
      return service.unconfirm(cycleId);
    case "cycle.replaceAll":
      return service.replaceAll(cycleId);
    case "auto.start":
      return service.autoStart(cycleId);
    case "auto.confirm":
      return service.autoConfirm(cycleId);
    case "auto.reroll":
      return service.autoReroll(cycleId);
    case "auto.manual":
      return service.autoManual(cycleId);
    case "discord.send":
      return service.sendDiscord(cycleId);
    case "discord.skip":
      return service.skipDiscord(cycleId);
    case "discord.prompt":
      return service.repromptDiscord(cycleId);
    case "discord.resend": {
      const [ok, detail] = await service.resendDiscord(cycleId);
      return { text: ok ? `Анонс отправлен повторно (${detail})` : `Не отправилось: ${detail}`, ok };
    }
    case "ptero.apply":
      return service.panelApply(cycleId);
    case "ptero.skip":
      return service.panelSkip(cycleId);
    case "ptero.status": {
      const status = await service.panelStatus();
      return status ? { text: "Задачи вайпа прочитаны", details: status } : { text: "Pterodactyl не настроен", ok: false };
    }
    case "global.toggle":
      return service.toggleGlobal(cycleId);
    case "check": {
      const rows = await runCheck();
      return { text: rows.every((r) => r.ok !== false) ? "Проверка пройдена" : "Есть проблемы", details: rows as unknown as Prisma.InputJsonValue, ok: rows.every((r) => r.ok !== false) };
    }
    default:
      return { text: `Неизвестное задание «${a.kind}»`, ok: false };
  }
}

// Ответы сервиса, означающие, что действие не выполнено: в панели они показываются как предупреждение.
const REFUSALS = /уже|нельзя|не найден|не задан|не настроен|нечего|нет карт|не актуален|ошибк|не отправ|подождите|прошёл|предыдущих карт нет/i;

let running = false;

export async function processActions(): Promise<void> {
  if (running) return;
  running = true;
  try {
    // Задания старше часа уже никому не нужны: панель давно показала, что бот не ответил.
    // Сюда же попадают задания, на которых бот перезапустился посреди работы.
    await prisma.mapsAction.updateMany({
      where: { status: { in: ["pending", "running"] }, createdAt: { lt: new Date(Date.now() - 3_600_000) } },
      data: { status: "error", result: "Бот не успел выполнить задание (был выключен?)", doneAt: new Date() },
    });
    const pending = await prisma.mapsAction.findMany({ where: { status: "pending" }, orderBy: { id: "asc" }, take: 10 });
    for (const a of pending) {
      // Забираем задание атомарно: второй процесс бота (например, при перезапуске) его не повторит.
      const { count } = await prisma.mapsAction.updateMany({ where: { id: a.id, status: "pending" }, data: { status: "running" } });
      if (count === 0) continue;
      let result: Result;
      try {
        result = await perform(a);
      } catch (err) {
        log.warn(`Задание из панели «${a.kind}» не выполнено`, err);
        result = { text: errorText(err).slice(0, 500), ok: false };
      }
      const r = typeof result === "string" ? { text: result, ok: !REFUSALS.test(result) } : result;
      await prisma.mapsAction.update({
        where: { id: a.id },
        data: { status: r.ok === false ? "error" : "done", result: r.text.slice(0, 1000), details: r.details, doneAt: new Date() },
      });
      if (a.kind !== "check" && a.kind !== "ptero.status") {
        event("bot.panel_action", `Из панели (${a.byName ?? "?"}): ${MAPS_ACTION_LABEL[a.kind] ?? a.kind} — ${r.text}`.slice(0, 1000), { details: { kind: a.kind, args: a.args, ok: r.ok !== false } });
      }
    }
  } finally {
    running = false;
  }
}
