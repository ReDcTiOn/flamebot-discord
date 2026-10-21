import type { Prisma } from "@prisma/client";
import type { Db } from "./db.js";

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
export async function recordEvent(db: Db, e: BotEventInput): Promise<void> {
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

// Группы событий для фильтров в панели, по ботам: префикс type → название.
export const EVENT_GROUPS_BY_BOT: Record<string, Record<string, string>> = {
  rating: {
    shop: "Магазин",
    rank: "Ранги",
    rep: "Репутация",
    customrole: "Личные роли",
    purchase: "Сроки покупок",
    role: "Роли",
    bot: "Система",
  },
  online: {
    server: "Серверы",
    bot: "Система",
  },
  giveaway: {
    giveaway: "Розыгрыши",
    promo: "Промокоды",
    bot: "Система",
  },
  maps: {
    cycle: "Вайпы",
    map: "Карты",
    discord: "Анонсы",
    ptero: "Pterodactyl",
    telegram: "Telegram",
    bot: "Система",
  },
};
