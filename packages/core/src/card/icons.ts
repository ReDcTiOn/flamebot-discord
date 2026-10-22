// Встроенные иконки карточки, лежат в packages/core/assets/icons.
// В тексте элемента иконка ставится подстановкой вида {scrap_icon} и рисуется размером с букву.
export const CARD_ICONS = {
  scrap: { label: "иконка скрапа", file: "scrap.png" },
} as const;

export type CardIconKey = keyof typeof CARD_ICONS;

export const CARD_ICON_FILES: string[] = Object.values(CARD_ICONS).map((i) => i.file);

export function isCardIcon(key: string): key is CardIconKey {
  return Object.hasOwn(CARD_ICONS, key);
}
