import path from "node:path";
import { createCanvas, GlobalFonts, loadImage, type Image } from "@napi-rs/canvas";
import { cardFontsDir, getCardLayout, prisma } from "@flamebot/core";
import { CARD_FONTS, cardAssetIds, renderCard, type CardData, type CardLayout } from "@flamebot/core/card";
import { log } from "../logger.js";

let fontsReady = false;

export function registerFonts() {
  if (fontsReady) return;
  const dir = cardFontsDir();
  for (const font of Object.values(CARD_FONTS)) {
    for (const file of Object.values(font.files)) {
      if (!GlobalFonts.registerFromPath(path.join(dir, file), font.family)) log.warn(`Не загрузился шрифт ${file}`);
    }
  }
  fontsReady = true;
}

// Шаблон и картинки меняются редко: держим их в памяти, шаблон перечитываем раз в 15 секунд.
const LAYOUT_TTL_MS = 15_000;
let layoutCache: { layout: CardLayout; at: number } | null = null;
const assetCache = new Map<number, Image>();

async function currentLayout(): Promise<CardLayout> {
  if (layoutCache && Date.now() - layoutCache.at < LAYOUT_TTL_MS) return layoutCache.layout;
  const layout = await getCardLayout(prisma);
  layoutCache = { layout, at: Date.now() };
  return layout;
}

async function loadAssets(ids: number[]): Promise<Map<number, Image>> {
  const missing = ids.filter((id) => !assetCache.has(id));
  if (missing.length > 0) {
    const rows = await prisma.cardAsset.findMany({ where: { id: { in: missing } } });
    for (const row of rows) {
      try {
        assetCache.set(row.id, await loadImage(Buffer.from(row.data)));
      } catch (err) {
        log.warn(`Не удалось прочитать картинку карточки #${row.id}`, err);
      }
    }
  }
  // Удалённые из шаблона картинки из памяти тоже убираем.
  for (const id of assetCache.keys()) if (!ids.includes(id)) assetCache.delete(id);
  return new Map(ids.flatMap((id) => (assetCache.has(id) ? [[id, assetCache.get(id)!] as const] : [])));
}

async function loadAvatar(url: string): Promise<Image | null> {
  try {
    // Только CDN Discord: адрес строит discord.js, а не пользователь.
    if (!url.startsWith("https://cdn.discordapp.com/")) return null;
    const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > 5 * 1024 * 1024) return null;
    return await loadImage(buf);
  } catch {
    return null;
  }
}

export async function renderProfileCard(data: CardData, avatarUrl: string): Promise<Buffer> {
  registerFonts();
  const layout = await currentLayout();
  const [assets, avatar] = await Promise.all([loadAssets(cardAssetIds(layout)), loadAvatar(avatarUrl)]);
  const canvas = createCanvas(layout.width, layout.height);
  renderCard(canvas.getContext("2d"), layout, data, { avatar, assets });
  return canvas.toBuffer("image/png");
}
