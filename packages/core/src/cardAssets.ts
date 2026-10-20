import path from "node:path";
import { fileURLToPath } from "node:url";
import { DEFAULT_CARD_LAYOUT, cardLayoutSchema, type CardLayout } from "./card/index.js";
import type { Db } from "./db.js";

// Папка со шрифтами карточки. Только для Node (бот, сервер панели).
export function cardFontsDir(): string {
  // Не new URL(..., import.meta.url): сборщик панели принял бы это за импорт файла.
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "assets", "fonts");
}

// Шаблон из базы. Если записи нет или она повреждена — стандартный шаблон.
export async function getCardLayout(db: Db): Promise<CardLayout> {
  const row = await db.profileCard.findUnique({ where: { id: 1 } });
  if (!row) return DEFAULT_CARD_LAYOUT;
  const parsed = cardLayoutSchema.safeParse(row.layout);
  return parsed.success ? parsed.data : DEFAULT_CARD_LAYOUT;
}
