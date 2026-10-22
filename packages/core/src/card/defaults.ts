import type { CardLayout } from "./schema.js";

export const DEFAULT_CARD_LAYOUT: CardLayout = {
  version: 1,
  width: 1000,
  height: 360,
  radius: 24,
  background: { color: "#141414", imageAssetId: null, overlayColor: "#000000", overlayOpacity: 0.35 },
  elements: [
    { id: "panel", name: "Подложка", type: "rect", visible: true, x: 24, y: 24, opacity: 0.85, width: 952, height: 312, radius: 18, color: "#1c1c1c" },
    { id: "avatar", name: "Аватар", type: "avatar", visible: true, x: 56, y: 64, opacity: 1, size: 168, shape: "circle", borderWidth: 6, borderColor: "#c9822a" },
    { id: "name", name: "Имя", type: "text", visible: true, x: 256, y: 66, opacity: 1, text: "{name}", font: "montserrat", weight: 700, size: 44, color: "#f2f2f2", align: "left", maxWidth: 520, uppercase: false, shadow: false },
    { id: "rank", name: "Ранг", type: "text", visible: true, x: 256, y: 124, opacity: 1, text: "{rank}", font: "russo", weight: 400, size: 26, color: "#ef9f27", align: "left", maxWidth: 520, uppercase: true, shadow: false },
    { id: "place", name: "Место", type: "text", visible: true, x: 936, y: 66, opacity: 1, text: "#{place}", font: "russo", weight: 400, size: 44, color: "#f2f2f2", align: "right", maxWidth: 0, uppercase: false, shadow: false },
    { id: "place_label", name: "Подпись места", type: "text", visible: true, x: 936, y: 118, opacity: 1, text: "место в топе", font: "inter", weight: 400, size: 16, color: "#8e8e8e", align: "right", maxWidth: 0, uppercase: false, shadow: false },
    { id: "progress", name: "Прогресс", type: "progress", visible: true, x: 256, y: 186, opacity: 1, width: 680, height: 18, radius: 9, trackColor: "#2a2a2a", fillColor: "#c9822a", source: "level" },
    { id: "xp", name: "Опыт", type: "text", visible: true, x: 256, y: 214, opacity: 1, text: "Уровень {level} · {xp} опыта", font: "inter", weight: 600, size: 18, color: "#d0d0d0", align: "left", maxWidth: 0, uppercase: false, shadow: false },
    { id: "next", name: "Следующий ранг", type: "text", visible: true, x: 936, y: 214, opacity: 1, text: "{level_xp} / {level_need}", font: "inter", weight: 400, size: 18, color: "#8e8e8e", align: "right", maxWidth: 400, uppercase: false, shadow: false },
    { id: "scrap", name: "Скрап", type: "text", visible: true, x: 256, y: 262, opacity: 1, text: "Скрап: {scrap}", font: "inter", weight: 700, size: 22, color: "#f2f2f2", align: "left", maxWidth: 0, uppercase: false, shadow: false },
    { id: "rep", name: "Репутация", type: "text", visible: true, x: 486, y: 262, opacity: 1, text: "Репутация: {rep}", font: "inter", weight: 700, size: 22, color: "#f2f2f2", align: "left", maxWidth: 0, uppercase: false, shadow: false },
    { id: "badges", name: "Бейджи", type: "badges", visible: true, x: 256, y: 300, opacity: 1, size: 14, font: "inter", color: "#2a2a2a", textColor: "#d0d0d0", gap: 6, maxCount: 3 },
  ],
};

