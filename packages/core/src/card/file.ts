import { z } from "zod";
import type { CardLayout } from "./schema.js";

// Файл карточки: шаблон вместе с картинками, чтобы карточку можно было хранить у себя
// и загрузить обратно в любую панель. Номера картинок в файле — те, что были в базе
// при выгрузке; при загрузке картинки сохраняются заново и получают новые номера.
export const CARD_FILE_FORMAT = "flamebot-card";
export const CARD_FILE_MAX_BYTES = 15 * 1024 * 1024;

export const cardFileSchema = z.object({
  format: z.literal(CARD_FILE_FORMAT),
  version: z.literal(1),
  name: z.string().trim().max(40).optional(),
  exportedAt: z.string().max(40).optional(),
  // Шаблон проверяется отдельно, после замены номеров картинок.
  layout: z.unknown(),
  assets: z
    .array(
      z.object({
        id: z.number().int().positive(),
        mime: z.string().max(40),
        data: z.string().max(8_000_000), // base64
      }),
    )
    .max(41)
    .default([]),
});

export type CardFile = z.infer<typeof cardFileSchema>;

export function cardFileName(name: string): string {
  const safe = name.trim().replace(/[\\/:*?"<>|\u0000-\u001f]+/g, "_").slice(0, 40);
  return `карточка-${safe || "без названия"}.json`;
}

// Меняет номера картинок в шаблоне. Картинку без пары убирает, чтобы шаблон не ссылался на чужую.
export function remapCardAssets(layout: CardLayout, map: Map<number, number>): CardLayout {
  const swap = (id: number | null) => (id === null ? null : (map.get(id) ?? null));
  return {
    ...layout,
    background: { ...layout.background, imageAssetId: swap(layout.background.imageAssetId) },
    elements: layout.elements.map((el) => (el.type === "image" ? { ...el, assetId: swap(el.assetId) } : el)),
  };
}
