import { cardFontString } from "./fonts.js";
import type { CardElement, CardLayout } from "./schema.js";

// Минимальный набор Canvas 2D API. Ему соответствуют и CanvasRenderingContext2D в браузере,
// и контекст @napi-rs/canvas в боте, поэтому рисование одно на оба мира.
export interface Ctx2D {
  save(): void;
  restore(): void;
  beginPath(): void;
  closePath(): void;
  moveTo(x: number, y: number): void;
  lineTo(x: number, y: number): void;
  arcTo(x1: number, y1: number, x2: number, y2: number, r: number): void;
  rect(x: number, y: number, w: number, h: number): void;
  fill(): void;
  stroke(): void;
  clip(): void;
  clearRect(x: number, y: number, w: number, h: number): void;
  fillRect(x: number, y: number, w: number, h: number): void;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  drawImage(image: any, ...args: number[]): void;
  fillText(text: string, x: number, y: number): void;
  measureText(text: string): { width: number };
  globalAlpha: number;
  fillStyle: unknown;
  strokeStyle: unknown;
  lineWidth: number;
  font: string;
  textAlign: string;
  textBaseline: string;
  shadowColor: string;
  shadowBlur: number;
  shadowOffsetX: number;
  shadowOffsetY: number;
}

export interface ImageLike {
  width: number;
  height: number;
}

export interface CardData {
  name: string;
  username: string;
  rank: string;
  nextRank: string;
  xp: number;
  nextXp: number | null;
  progress: number;
  scrap: number;
  rep: number;
  messages: number;
  place: number;
  server: string;
  badges: string[];
}

export interface CardImages {
  avatar: ImageLike | null;
  assets: Map<number, ImageLike>;
}

export const CARD_PLACEHOLDERS: { key: string; label: string }[] = [
  { key: "{name}", label: "имя на сервере" },
  { key: "{username}", label: "логин Discord" },
  { key: "{rank}", label: "текущий ранг" },
  { key: "{next_rank}", label: "следующий ранг" },
  { key: "{xp}", label: "опыт" },
  { key: "{next_xp}", label: "порог следующего ранга" },
  { key: "{xp_left}", label: "сколько осталось" },
  { key: "{next_info}", label: "«до ранга: N» или «максимальный ранг»" },
  { key: "{progress}", label: "прогресс в %" },
  { key: "{scrap}", label: "скрап" },
  { key: "{rep}", label: "репутация" },
  { key: "{messages}", label: "сообщений засчитано" },
  { key: "{place}", label: "место в топе" },
  { key: "{server}", label: "название сервера" },
];

const nf = new Intl.NumberFormat("ru-RU");

// Эмодзи в картинке без отдельного шрифта рисуются квадратиками, поэтому убираем их.
export function stripEmoji(text: string): string {
  return text.replace(/[\p{Extended_Pictographic}\u{FE0F}\u{200D}\u{20E3}]/gu, "").replace(/\s{2,}/g, " ").trim();
}

export function fillPlaceholders(template: string, d: CardData): string {
  const values: Record<string, string> = {
    name: d.name,
    username: d.username,
    rank: d.rank,
    next_rank: d.nextRank,
    xp: nf.format(d.xp),
    next_xp: d.nextXp === null ? "максимум" : nf.format(d.nextXp),
    xp_left: d.nextXp === null ? "—" : nf.format(Math.max(0, d.nextXp - d.xp)),
    next_info: d.nextXp === null ? "максимальный ранг" : `до «${d.nextRank}»: ${nf.format(Math.max(0, d.nextXp - d.xp))}`,
    progress: `${Math.round(d.progress * 100)}%`,
    scrap: nf.format(d.scrap),
    rep: nf.format(d.rep),
    messages: nf.format(d.messages),
    place: nf.format(d.place),
    server: d.server,
  };
  return stripEmoji(template.replace(/\{(\w+)\}/g, (m, key: string) => (Object.hasOwn(values, key) ? values[key]! : m)));
}

function roundedPath(ctx: Ctx2D, x: number, y: number, w: number, h: number, r: number) {
  const radius = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
}

function drawFitted(ctx: Ctx2D, img: ImageLike, x: number, y: number, w: number, h: number, fit: "cover" | "contain") {
  const scale = fit === "cover" ? Math.max(w / img.width, h / img.height) : Math.min(w / img.width, h / img.height);
  const dw = img.width * scale;
  const dh = img.height * scale;
  ctx.drawImage(img, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh);
}

function ellipsize(ctx: Ctx2D, text: string, maxWidth: number): string {
  if (maxWidth <= 0 || ctx.measureText(text).width <= maxWidth) return text;
  let lo = 0;
  let hi = text.length;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (ctx.measureText(text.slice(0, mid) + "…").width <= maxWidth) lo = mid;
    else hi = mid - 1;
  }
  return text.slice(0, lo).trimEnd() + "…";
}

function drawElement(ctx: Ctx2D, el: CardElement, data: CardData, images: CardImages) {
  switch (el.type) {
    case "rect": {
      roundedPath(ctx, el.x, el.y, el.width, el.height, el.radius);
      ctx.fillStyle = el.color;
      ctx.fill();
      return;
    }
    case "avatar": {
      const r = el.shape === "circle" ? el.size / 2 : el.shape === "rounded" ? el.size * 0.2 : 0;
      ctx.save();
      roundedPath(ctx, el.x, el.y, el.size, el.size, r);
      ctx.clip();
      if (images.avatar) drawFitted(ctx, images.avatar, el.x, el.y, el.size, el.size, "cover");
      else {
        ctx.fillStyle = "#2a2a2a";
        ctx.fillRect(el.x, el.y, el.size, el.size);
      }
      ctx.restore();
      if (el.borderWidth > 0) {
        const half = el.borderWidth / 2;
        roundedPath(ctx, el.x + half, el.y + half, el.size - el.borderWidth, el.size - el.borderWidth, Math.max(0, r - half));
        ctx.strokeStyle = el.borderColor;
        ctx.lineWidth = el.borderWidth;
        ctx.stroke();
      }
      return;
    }
    case "progress": {
      roundedPath(ctx, el.x, el.y, el.width, el.height, el.radius);
      ctx.fillStyle = el.trackColor;
      ctx.fill();
      const w = Math.round(el.width * Math.min(1, Math.max(0, data.progress)));
      if (w > 0) {
        ctx.save();
        roundedPath(ctx, el.x, el.y, el.width, el.height, el.radius);
        ctx.clip();
        roundedPath(ctx, el.x, el.y, Math.max(w, el.height), el.height, el.radius);
        ctx.fillStyle = el.fillColor;
        ctx.fill();
        ctx.restore();
      }
      return;
    }
    case "image": {
      const img = el.assetId ? images.assets.get(el.assetId) : undefined;
      if (!img) return;
      ctx.save();
      roundedPath(ctx, el.x, el.y, el.width, el.height, el.radius);
      ctx.clip();
      drawFitted(ctx, img, el.x, el.y, el.width, el.height, el.fit);
      ctx.restore();
      return;
    }
    case "text": {
      let text = fillPlaceholders(el.text, data);
      if (el.uppercase) text = text.toLocaleUpperCase("ru-RU");
      if (!text) return;
      ctx.font = cardFontString(el.font, el.weight, el.size);
      ctx.textAlign = el.align;
      ctx.textBaseline = "top";
      ctx.fillStyle = el.color;
      if (el.shadow) {
        ctx.shadowColor = "rgba(0,0,0,0.6)";
        ctx.shadowBlur = Math.round(el.size / 4);
        ctx.shadowOffsetY = Math.max(1, Math.round(el.size / 16));
      }
      ctx.fillText(ellipsize(ctx, text, el.maxWidth), el.x, el.y);
      return;
    }
    case "badges": {
      const labels = data.badges.map(stripEmoji).filter(Boolean).slice(0, el.maxCount);
      ctx.font = cardFontString(el.font, 600, el.size);
      ctx.textAlign = "left";
      ctx.textBaseline = "top";
      const padX = Math.round(el.size * 0.8);
      const padY = Math.round(el.size * 0.45);
      const h = el.size + padY * 2;
      let x = el.x;
      for (const label of labels) {
        const w = ctx.measureText(label).width + padX * 2;
        roundedPath(ctx, x, el.y, w, h, h / 2);
        ctx.fillStyle = el.color;
        ctx.fill();
        ctx.fillStyle = el.textColor;
        ctx.fillText(label, x + padX, el.y + padY);
        x += w + el.gap;
      }
      return;
    }
  }
}

export function renderCard(ctx: Ctx2D, layout: CardLayout, data: CardData, images: CardImages): void {
  const { width, height } = layout;
  ctx.clearRect(0, 0, width, height);
  ctx.save();
  roundedPath(ctx, 0, 0, width, height, layout.radius);
  ctx.clip();

  ctx.fillStyle = layout.background.color;
  ctx.fillRect(0, 0, width, height);
  const bg = layout.background.imageAssetId ? images.assets.get(layout.background.imageAssetId) : undefined;
  if (bg) drawFitted(ctx, bg, 0, 0, width, height, "cover");
  if (layout.background.overlayOpacity > 0) {
    ctx.globalAlpha = layout.background.overlayOpacity;
    ctx.fillStyle = layout.background.overlayColor;
    ctx.fillRect(0, 0, width, height);
    ctx.globalAlpha = 1;
  }

  for (const el of layout.elements) {
    if (!el.visible || el.opacity <= 0) continue;
    ctx.save();
    ctx.globalAlpha = el.opacity;
    drawElement(ctx, el, data, images);
    ctx.restore();
  }
  ctx.restore();
}

// Примерные границы элемента — для выделения и перетаскивания в редакторе.
export function elementBounds(ctx: Ctx2D, el: CardElement, data: CardData): { x: number; y: number; w: number; h: number } {
  switch (el.type) {
    case "rect":
    case "image":
    case "progress":
      return { x: el.x, y: el.y, w: el.width, h: el.height };
    case "avatar":
      return { x: el.x, y: el.y, w: el.size, h: el.size };
    case "text": {
      let text = fillPlaceholders(el.text, data);
      if (el.uppercase) text = text.toLocaleUpperCase("ru-RU");
      ctx.font = cardFontString(el.font, el.weight, el.size);
      const w = Math.max(20, Math.min(ctx.measureText(text || " ").width, el.maxWidth > 0 ? el.maxWidth : Infinity));
      const x = el.align === "left" ? el.x : el.align === "center" ? el.x - w / 2 : el.x - w;
      return { x, y: el.y, w, h: Math.round(el.size * 1.2) };
    }
    case "badges": {
      ctx.font = cardFontString(el.font, 600, el.size);
      const padX = Math.round(el.size * 0.8);
      const labels = (data.badges.length ? data.badges : ["Бейдж"]).slice(0, el.maxCount);
      const w = labels.reduce((s, l) => s + ctx.measureText(l).width + padX * 2 + el.gap, 0) - el.gap;
      return { x: el.x, y: el.y, w: Math.max(40, w), h: el.size + Math.round(el.size * 0.45) * 2 };
    }
  }
}
