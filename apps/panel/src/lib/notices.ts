import { fmtNoticeStamp, getNoticeSettings, prisma, type NoticeSettings, type Prisma } from "@flamebot/core";

export { NOTICE_ACTION_LABEL } from "@flamebot/core";

// Задания, которые панель может поставить боту объявлений. Публикует, создаёт промокоды и пишет
// в Telegram только бот: панель просит, а бот выполняет тем же кодом, что и кнопки в Telegram.
export const NOTICE_ACTION_KINDS = ["event.confirm", "event.template", "event.skip", "event.retry", "test.start", "reminder.test", "promos.list", "check"] as const;
export type NoticeActionKind = (typeof NOTICE_ACTION_KINDS)[number];

export interface BotActionResult {
  done: boolean; // бот успел ответить
  ok: boolean;
  text: string;
  details: Prisma.JsonValue | null;
}

// Ставит задание боту и ждёт ответа до timeoutMs.
export async function runNoticeAction(
  kind: NoticeActionKind,
  args: Record<string, string | number>,
  by: { id: string; username: string },
  timeoutMs = 15_000,
): Promise<BotActionResult> {
  const a = await prisma.noticeAction.create({ data: { kind, args, byId: by.id, byName: by.username } });
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 400));
    const row = await prisma.noticeAction.findUnique({ where: { id: a.id } });
    if (row && (row.status === "done" || row.status === "error")) {
      return { done: true, ok: row.status === "done", text: row.result ?? "Готово", details: row.details };
    }
  }
  return { done: false, ok: true, text: "Бот ещё выполняет задание: результат появится на странице.", details: null };
}

export async function noticesView(): Promise<{ s: NoticeSettings; fmt: (d: Date) => string }> {
  const s = await getNoticeSettings(prisma);
  return { s, fmt: (d: Date) => `${fmtNoticeStamp(d, s.timezone)} ${s.timezoneLabel}` };
}

export const NOTICE_STATUS_CHIP: Record<string, string> = {
  pending: "chip accent",
  sending: "chip warn",
  sent: "chip success",
  partial: "chip danger",
  skipped: "chip",
  missed: "chip danger",
};

export const RESULT_CHIP: Record<string, string> = { ok: "chip success", dry: "chip", error: "chip danger", warn: "chip warn", none: "chip" };
