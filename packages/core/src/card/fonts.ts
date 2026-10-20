import type { CardFontKey } from "./schema.js";

// Шрифты лежат в packages/core/assets/fonts (лицензия SIL OFL 1.1).
// Имена семейств одинаковые в боте (@napi-rs/canvas) и в браузере (FontFace),
// поэтому карточка выглядит одинаково и в редакторе, и в Discord.
export const CARD_FONTS: Record<CardFontKey, { label: string; family: string; files: Partial<Record<400 | 600 | 700, string>> }> = {
  inter: {
    label: "Inter",
    family: "FB Inter",
    files: { 400: "Inter_400Regular.ttf", 600: "Inter_600SemiBold.ttf", 700: "Inter_700Bold.ttf" },
  },
  montserrat: {
    label: "Montserrat",
    family: "FB Montserrat",
    files: { 400: "Montserrat_400Regular.ttf", 600: "Montserrat_600SemiBold.ttf", 700: "Montserrat_700Bold.ttf" },
  },
  oswald: {
    label: "Oswald",
    family: "FB Oswald",
    files: { 400: "Oswald_400Regular.ttf", 600: "Oswald_600SemiBold.ttf", 700: "Oswald_700Bold.ttf" },
  },
  russo: {
    label: "Russo One",
    family: "FB Russo One",
    files: { 400: "RussoOne_400Regular.ttf" },
  },
};

export const CARD_FONT_FILES: string[] = Object.values(CARD_FONTS).flatMap((f) => Object.values(f.files));

export function cardFontString(font: CardFontKey, weight: number, size: number): string {
  // Inter вторым — запасной шрифт для символов, которых нет в выбранном.
  return `${weight} ${size}px "${CARD_FONTS[font].family}", "${CARD_FONTS.inter.family}"`;
}
