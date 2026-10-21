import { prisma, type GiveawayStatus } from "@flamebot/core";

export const GIVEAWAY_STATUS: Record<GiveawayStatus, { label: string; chip: string }> = {
  ACTIVE: { label: "Идёт", chip: "chip success" },
  ENDED: { label: "Завершён", chip: "chip" },
  CANCELLED: { label: "Отменён", chip: "chip danger" },
};

// Имена людей по Discord ID. Бот розыгрышей имён не хранит, поэтому берём их из таблицы
// игроков рейтинга: там есть все, кто писал в чат. Остальные показываются по ID.
export async function memberNames(ids: string[]): Promise<Map<string, string>> {
  const unique = [...new Set(ids)];
  if (unique.length === 0) return new Map();
  const rows = await prisma.member.findMany({ where: { id: { in: unique } }, select: { id: true, displayName: true } });
  return new Map(rows.map((m) => [m.id, m.displayName]));
}

export async function channelNames(ids: string[]): Promise<Map<string, string>> {
  const rows = await prisma.guildChannel.findMany({ where: { id: { in: [...new Set(ids)] } }, select: { id: true, name: true } });
  return new Map(rows.map((c) => [c.id, c.name]));
}

// «через 3 ч», «2 д назад» — для обзора.
export function relative(d: Date): string {
  const diff = d.getTime() - Date.now();
  const abs = Math.abs(diff);
  const min = Math.round(abs / 60_000);
  const text = min < 60 ? `${Math.max(1, min)} мин` : min < 48 * 60 ? `${Math.round(min / 60)} ч` : `${Math.round(min / 1440)} д`;
  return diff >= 0 ? `через ${text}` : `${text} назад`;
}
