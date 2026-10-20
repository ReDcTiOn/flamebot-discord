import { elementBounds, type CardData, type CardElement, type CardLayout, type Ctx2D } from "@flamebot/core/card";

export type Box = { x: number; y: number; w: number; h: number };
export type Handle = "nw" | "n" | "ne" | "e" | "se" | "s" | "sw" | "w";
export type Guides = { xs: number[]; ys: number[] };

const ALL: Handle[] = ["nw", "n", "ne", "e", "se", "s", "sw", "w"];

// Какие ручки есть у элемента: у прямоугольников все восемь,
// у аватара только углы (он квадратный), у текста — ширина и размер шрифта.
export function handlesFor(el: CardElement): Handle[] {
  switch (el.type) {
    case "rect":
    case "image":
    case "progress":
      return ALL;
    case "avatar":
      return ["nw", "ne", "se", "sw"];
    case "text":
      return el.align === "right" ? ["w", "sw"] : ["e", "se"];
    case "badges":
      return ["se"];
  }
}

export const CURSOR: Record<Handle, string> = {
  nw: "nwse-resize",
  se: "nwse-resize",
  ne: "nesw-resize",
  sw: "nesw-resize",
  n: "ns-resize",
  s: "ns-resize",
  e: "ew-resize",
  w: "ew-resize",
};

export function handlePoint(b: Box, h: Handle): { x: number; y: number } {
  const x = h.includes("w") ? b.x : h.includes("e") ? b.x + b.w : b.x + b.w / 2;
  const y = h.includes("n") ? b.y : h.includes("s") ? b.y + b.h : b.y + b.h / 2;
  return { x, y };
}

export function hitHandle(b: Box, handles: Handle[], p: { x: number; y: number }, tol: number): Handle | null {
  for (const h of handles) {
    const q = handlePoint(b, h);
    if (Math.abs(p.x - q.x) <= tol && Math.abs(p.y - q.y) <= tol) return h;
  }
  return null;
}

// Линии, к которым прилипают элементы: края и центр карточки, края и центры остальных элементов.
export function snapTargets(ctx: Ctx2D, layout: CardLayout, data: CardData, exceptId: string): Guides {
  const xs = [0, layout.width / 2, layout.width];
  const ys = [0, layout.height / 2, layout.height];
  for (const el of layout.elements) {
    if (el.id === exceptId || !el.visible) continue;
    const b = elementBounds(ctx, el, data);
    xs.push(b.x, b.x + b.w / 2, b.x + b.w);
    ys.push(b.y, b.y + b.h / 2, b.y + b.h);
  }
  return { xs, ys };
}

function nearest(values: number[], targets: number[], tol: number): { delta: number; at: number } | null {
  let best: { delta: number; at: number } | null = null;
  for (const v of values) {
    for (const t of targets) {
      const d = t - v;
      if (Math.abs(d) <= tol && (!best || Math.abs(d) < Math.abs(best.delta))) best = { delta: d, at: t };
    }
  }
  return best;
}

export function snapMove(b: Box, targets: Guides, tol: number): { dx: number; dy: number; guides: Guides } {
  const sx = nearest([b.x, b.x + b.w / 2, b.x + b.w], targets.xs, tol);
  const sy = nearest([b.y, b.y + b.h / 2, b.y + b.h], targets.ys, tol);
  return {
    dx: sx?.delta ?? 0,
    dy: sy?.delta ?? 0,
    guides: { xs: sx ? [sx.at] : [], ys: sy ? [sy.at] : [] },
  };
}

function snapValue(v: number, targets: number[], tol: number, guides: number[]): number {
  const s = nearest([v], targets, tol);
  if (!s) return v;
  guides.push(s.at);
  return s.at;
}

const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, Math.round(v)));

// Новое состояние элемента при перетаскивании ручки. start — элемент и его рамка в момент нажатия.
export function resizeElement(
  start: { el: CardElement; box: Box },
  handle: Handle,
  p: { x: number; y: number },
  opts: { keepRatio: boolean; targets: Guides | null; tol: number },
): { patch: Record<string, number>; guides: Guides } {
  const { el, box } = start;
  const guides: Guides = { xs: [], ys: [] };
  let left = box.x;
  let top = box.y;
  let right = box.x + box.w;
  let bottom = box.y + box.h;
  const t = opts.targets;

  if (handle.includes("w")) left = t ? snapValue(p.x, t.xs, opts.tol, guides.xs) : p.x;
  if (handle.includes("e")) right = t ? snapValue(p.x, t.xs, opts.tol, guides.xs) : p.x;
  if (handle.includes("n")) top = t ? snapValue(p.y, t.ys, opts.tol, guides.ys) : p.y;
  if (handle.includes("s")) bottom = t ? snapValue(p.y, t.ys, opts.tol, guides.ys) : p.y;

  let w = Math.max(4, right - left);
  let h = Math.max(4, bottom - top);

  const corner = handle.length === 2;
  const uniform = el.type === "avatar" || el.type === "badges" || (el.type === "text" && corner) || (opts.keepRatio && corner);
  if (uniform) {
    const k = Math.max(w / box.w, h / box.h);
    w = box.w * k;
    h = box.h * k;
    guides.xs = [];
    guides.ys = [];
  }
  // Противоположный угол остаётся на месте.
  const x = handle.includes("w") ? box.x + box.w - w : box.x;
  const y = handle.includes("n") ? box.y + box.h - h : box.y;

  switch (el.type) {
    case "rect":
    case "image":
      return { patch: { x: Math.round(x), y: Math.round(y), width: clamp(w, 1, 4000), height: clamp(h, 1, 4000) }, guides };
    case "progress":
      return { patch: { x: Math.round(x), y: Math.round(y), width: clamp(w, 1, 4000), height: clamp(h, 1, 200) }, guides };
    case "avatar": {
      const size = clamp(w, 8, 800);
      return {
        patch: { x: Math.round(handle.includes("w") ? box.x + box.w - size : box.x), y: Math.round(handle.includes("n") ? box.y + box.h - size : box.y), size },
        guides,
      };
    }
    case "badges":
      return { patch: { size: clamp(el.size * (h / box.h), 8, 64) }, guides };
    case "text": {
      if (corner) return { patch: { size: clamp(el.size * (h / box.h), 8, 200) }, guides };
      // Боковая ручка задаёт максимальную ширину: длинный текст обрежется многоточием.
      const width = clamp(w, 20, 4000);
      return { patch: { maxWidth: width, ...(handle === "w" && el.align === "left" ? { x: Math.round(box.x + box.w - width) } : {}) }, guides };
    }
  }
}

export type AlignKind = "left" | "hcenter" | "right" | "top" | "vcenter" | "bottom";

// Сдвиг элемента так, чтобы его рамка встала по краю или центру карточки.
export function alignOffset(b: Box, layout: CardLayout, kind: AlignKind): { dx: number; dy: number } {
  switch (kind) {
    case "left":
      return { dx: -b.x, dy: 0 };
    case "hcenter":
      return { dx: layout.width / 2 - (b.x + b.w / 2), dy: 0 };
    case "right":
      return { dx: layout.width - (b.x + b.w), dy: 0 };
    case "top":
      return { dx: 0, dy: -b.y };
    case "vcenter":
      return { dx: 0, dy: layout.height / 2 - (b.y + b.h / 2) };
    case "bottom":
      return { dx: 0, dy: layout.height - (b.y + b.h) };
  }
}
