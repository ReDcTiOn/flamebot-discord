import type { Prisma, PrismaClient } from "@prisma/client";

export type EventLevelName = "INFO" | "WARN" | "ERROR";

export interface BotEventInput {
  botKey: string;
  level?: EventLevelName;
  type: string;
  message: string;
  memberId?: string | null;
  details?: Prisma.InputJsonValue;
}

// Запись события в историю. Ошибка записи не должна ломать то, что событие описывает.
export async function recordEvent(db: PrismaClient, e: BotEventInput): Promise<void> {
  try {
    await db.botEvent.create({
      data: {
        botKey: e.botKey,
        level: e.level ?? "INFO",
        type: e.type.slice(0, 64),
        message: e.message.slice(0, 1000),
        memberId: e.memberId ?? null,
        details: e.details,
      },
    });
  } catch (err) {
    console.error("Не удалось записать событие в историю", err instanceof Error ? err.message : err);
  }
}

// Группы событий для фильтров в панели: префикс type → название.
export const EVENT_GROUPS: Record<string, string> = {
  shop: "Магазин",
  rank: "Ранги",
  rep: "Репутация",
  customrole: "Личные роли",
  purchase: "Сроки покупок",
  role: "Роли",
  bot: "Система",
};
