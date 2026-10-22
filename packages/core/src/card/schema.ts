import { z } from "zod";

// Шаблон карточки профиля. Его редактирует панель, по нему рисует бот.
// Все границы жёсткие: шаблон приходит из браузера и не должен уронить бота.

export const CARD_FONT_KEYS = ["inter", "montserrat", "oswald", "russo"] as const;
export type CardFontKey = (typeof CARD_FONT_KEYS)[number];

const color = z.string().regex(/^#[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$/, "Цвет должен быть в формате #RRGGBB");
const coord = z.number().int().min(-2000).max(4000);
const len = (max: number) => z.number().int().min(1).max(max);
const opacity = z.number().min(0).max(1);

const base = {
  id: z.string().regex(/^[a-z0-9_-]{1,40}$/i),
  name: z.string().trim().min(1).max(40),
  visible: z.boolean(),
  x: coord,
  y: coord,
  opacity,
};

export const textElement = z.object({
  ...base,
  type: z.literal("text"),
  text: z.string().max(200),
  font: z.enum(CARD_FONT_KEYS),
  weight: z.union([z.literal(400), z.literal(600), z.literal(700)]),
  size: z.number().int().min(8).max(200),
  color,
  align: z.enum(["left", "center", "right"]),
  maxWidth: z.number().int().min(0).max(4000),
  uppercase: z.boolean(),
  shadow: z.boolean(),
});

export const avatarElement = z.object({
  ...base,
  type: z.literal("avatar"),
  size: len(800),
  shape: z.enum(["circle", "rounded", "square"]),
  borderWidth: z.number().int().min(0).max(40),
  borderColor: color,
});

export const progressElement = z.object({
  ...base,
  type: z.literal("progress"),
  width: len(4000),
  height: len(200),
  radius: z.number().int().min(0).max(100),
  trackColor: color,
  fillColor: color,
  // Что показывает полоса: путь до следующего ранга или до следующего уровня.
  source: z.enum(["rank", "level"]).default("rank"),
});

export const rectElement = z.object({
  ...base,
  type: z.literal("rect"),
  width: len(4000),
  height: len(4000),
  radius: z.number().int().min(0).max(500),
  color,
});

export const imageElement = z.object({
  ...base,
  type: z.literal("image"),
  width: len(4000),
  height: len(4000),
  radius: z.number().int().min(0).max(500),
  assetId: z.number().int().positive().nullable(),
  fit: z.enum(["cover", "contain"]),
});

export const badgesElement = z.object({
  ...base,
  type: z.literal("badges"),
  size: z.number().int().min(8).max(64),
  font: z.enum(CARD_FONT_KEYS),
  color,
  textColor: color,
  gap: z.number().int().min(0).max(60),
  maxCount: z.number().int().min(1).max(12),
});

export const cardElement = z.discriminatedUnion("type", [
  textElement,
  avatarElement,
  progressElement,
  rectElement,
  imageElement,
  badgesElement,
]);

export const cardLayoutSchema = z.object({
  version: z.literal(1),
  width: z.number().int().min(300).max(1600),
  height: z.number().int().min(150).max(1000),
  radius: z.number().int().min(0).max(100),
  background: z.object({
    color,
    imageAssetId: z.number().int().positive().nullable(),
    overlayColor: color,
    overlayOpacity: opacity,
  }),
  elements: z.array(cardElement).max(40),
});

export type CardLayout = z.infer<typeof cardLayoutSchema>;
export type CardElement = z.infer<typeof cardElement>;
export type CardElementType = CardElement["type"];

export function cardAssetIds(layout: CardLayout): number[] {
  const ids = new Set<number>();
  if (layout.background.imageAssetId) ids.add(layout.background.imageAssetId);
  for (const el of layout.elements) if (el.type === "image" && el.assetId) ids.add(el.assetId);
  return [...ids];
}
