import { join } from "node:path";
import { createCanvas, GlobalFonts, type SKRSContext2D } from "@napi-rs/canvas";
import { cardFontsDir, plural } from "@flamebot/core";
import type { GiveawayFull } from "./giveaways.js";

const width = 1080;
const height = 566;
const family = "GiveawayInter";
let fontReady = false;

function wrap(ctx: SKRSContext2D, text: string, maxWidth: number) {
  const lines: string[] = [];
  let line = "";
  for (const word of text.trim().split(/\s+/)) {
    const candidate = line ? `${line} ${word}` : word;
    if (line && ctx.measureText(candidate).width > maxWidth) {
      lines.push(line);
      line = "";
    }
    if (line) {
      line = candidate;
      continue;
    }
    for (const char of word) {
      if (line && ctx.measureText(line + char).width > maxWidth) {
        lines.push(line);
        line = "";
      }
      line += char;
    }
  }
  if (line) lines.push(line);
  return lines;
}

export async function renderBanner(g: GiveawayFull): Promise<Buffer> {
  if (!fontReady) {
    if (!GlobalFonts.registerFromPath(join(cardFontsDir(), "Inter_700Bold.ttf"), family)) {
      throw new Error("Не удалось загрузить шрифт баннера розыгрыша");
    }
    fontReady = true;
  }
  const ctx = createCanvas(width, height).getContext("2d");
  const ended = g.status === "ENDED";
  const gradient = ctx.createLinearGradient(0, 0, width, height);
  gradient.addColorStop(0, ended ? "#222f2b" : "#29232b");
  gradient.addColorStop(0.55, ended ? "#36443a" : "#473137");
  gradient.addColorStop(1, ended ? "#635640" : "#694236");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, width, height);

  const glow = ctx.createRadialGradient(888, 165, 0, 888, 165, 370);
  glow.addColorStop(0, "#f1a27655");
  glow.addColorStop(1, "#f1a27600");
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, width, height);
  ctx.strokeStyle = "#ffd3ab35";
  ctx.lineWidth = 2;
  for (const radius of [103, 132, 165]) {
    ctx.beginPath();
    ctx.ellipse(888, 190, radius, radius * 0.72, -0.56, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.fillStyle = "#ffd1a2";
  ctx.beginPath();
  ctx.roundRect(817, 155, 142, 100, 14);
  ctx.fill();
  ctx.fillStyle = "#f3aa84";
  ctx.beginPath();
  ctx.roundRect(805, 127, 166, 39, 8);
  ctx.fill();
  ctx.fillStyle = "#ac594c";
  ctx.fillRect(878, 127, 22, 128);
  ctx.strokeStyle = "#ffd1a2";
  ctx.lineWidth = 9;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(889, 129);
  ctx.bezierCurveTo(831, 121, 837, 75, 865, 94);
  ctx.quadraticCurveTo(880, 105, 889, 129);
  ctx.bezierCurveTo(900, 99, 925, 81, 932, 100);
  ctx.quadraticCurveTo(938, 119, 889, 129);
  ctx.stroke();

  const label = (text: string, x: number, y: number, size: number, color: string) => {
    ctx.font = `700 ${size}px ${family}`;
    ctx.fillStyle = color;
    ctx.fillText(text, x, y);
  };
  label(ended ? "FLAMERUST  /  ИТОГИ РОЗЫГРЫША" : "FLAMERUST  /  РОЗЫГРЫШ", 58, 79, 29, ended ? "#c2dbb3" : "#f4ad88");
  let size = 76;
  let lines: string[];
  do {
    ctx.font = `700 ${size}px ${family}`;
    lines = wrap(ctx, g.prize, 660);
    if (lines.length <= 3 || size <= 30) break;
    size -= 2;
  } while (true);
  const shown = lines.slice(0, 3);
  if (lines.length > 3) {
    let last = shown[2]!;
    while (last && ctx.measureText(last + "…").width > 660) last = last.slice(0, -1);
    shown[2] = last + "…";
  }
  shown.forEach((line, i) => label(line, 58, 226 + (i - (shown.length - 1) / 2) * (size + 9), size, "#fff3e9"));

  ctx.fillStyle = "#241f2890";
  ctx.beginPath();
  ctx.roundRect(56, 365, 968, 147, 18);
  ctx.fill();
  ctx.strokeStyle = "#ffc49f45";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(540, 391);
  ctx.lineTo(540, 488);
  ctx.stroke();
  label(String(g.entryCount), 89, 435, 56, "#fff3e9");
  label(ended ? "Всего участников" : "Участников", 91, 480, 32, "#efc8b4");
  label(String(g.winnersCount), 576, 435, 56, "#fff3e9");
  label(plural(g.winnersCount, "Приз", "Приза", "Призов"), 578, 480, 32, "#efc8b4");
  return ctx.canvas.encode("png");
}
