import { fmtWipe, getMapsSettings, prisma, type MapsSettings, type Prisma } from "@flamebot/core";

export { MAPS_ACTION_LABEL } from "@flamebot/core";

// Задания, которые панель может поставить боту карт. Логика карт живёт в боте:
// панель только просит, а бот выполняет тем же кодом, что и кнопки в Telegram.
export const MAPS_ACTION_KINDS = [
  "gen.start",
  "slot.approve",
  "slot.reroll",
  "slot.back",
  "slot.manual",
  "cycle.unconfirm",
  "cycle.replaceAll",
  "auto.start",
  "auto.confirm",
  "auto.reroll",
  "auto.manual",
  "discord.send",
  "discord.skip",
  "discord.prompt",
  "discord.resend",
  "ptero.apply",
  "ptero.skip",
  "ptero.status",
  "global.toggle",
  "check",
] as const;
export type MapsActionKind = (typeof MAPS_ACTION_KINDS)[number];


export interface BotActionResult {
  done: boolean; // бот успел ответить
  ok: boolean;
  text: string;
  details: Prisma.JsonValue | null;
}

// Ставит задание боту и ждёт ответа до timeoutMs. Долгие задания (загрузка карты по ссылке)
// бот доделает сам, а результат появится в списке действий на странице.
export async function runBotAction(
  kind: MapsActionKind,
  args: Record<string, string | number>,
  by: { id: string; username: string },
  timeoutMs = 12_000,
): Promise<BotActionResult> {
  const a = await prisma.mapsAction.create({ data: { kind, args, byId: by.id, byName: by.username } });
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 400));
    const row = await prisma.mapsAction.findUnique({ where: { id: a.id } });
    if (row && (row.status === "done" || row.status === "error")) {
      return { done: true, ok: row.status === "done", text: row.result ?? "Готово", details: row.details };
    }
  }
  return { done: false, ok: true, text: "Бот ещё выполняет задание: результат появится на странице.", details: null };
}

export async function mapsView(): Promise<{ s: MapsSettings; fmt: (d: Date) => string }> {
  const s = await getMapsSettings(prisma);
  return { s, fmt: (d: Date) => fmtWipe(d, s.timezone, s.timezoneLabel) };
}

export const SLOT_CHIP: Record<string, string> = {
  waiting: "chip",
  ready: "chip accent",
  uploading: "chip warn",
  uploaded: "chip success",
  error: "chip danger",
};

export const CYCLE_CHIP: Record<string, string> = {
  generating: "chip accent",
  scheduled: "chip success",
  awaiting_discord: "chip warn",
  skipped: "chip",
  sending: "chip warn",
  sent: "chip success",
};

export function fileName(url: string | null | undefined): string {
  const last = (url ?? "").split("/").pop() ?? "";
  try {
    return decodeURIComponent(last);
  } catch {
    return last;
  }
}
