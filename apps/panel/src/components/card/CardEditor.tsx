"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import {
  AlignCenterHorizontal,
  AlignCenterVertical,
  AlignEndHorizontal,
  AlignEndVertical,
  AlignStartHorizontal,
  AlignStartVertical,
  ArrowDown,
  ArrowUp,
  Copy,
  Eye,
  EyeOff,
  Magnet,
  Redo2,
  Trash2,
  Undo2,
  type LucideIcon,
} from "lucide-react";
import {
  CARD_FONTS,
  cardAssetIds,
  cardLayoutSchema,
  elementBounds,
  renderCard,
  type CardData,
  type CardElement,
  type CardElementType,
  type CardLayout,
  type Ctx2D,
} from "@flamebot/core/card";
import { saveCardLayout, uploadCardAsset } from "@/app/(panel)/rating/actions";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { useToast } from "@/components/ui/Toast";
import { ColorField, NumField, Row, SelectField } from "./controls";
import { ElementProps } from "./ElementProps";
import {
  CURSOR,
  alignOffset,
  handlePoint,
  handlesFor,
  hitHandle,
  resizeElement,
  snapMove,
  snapTargets,
  type AlignKind,
  type Box,
  type Guides,
  type Handle,
} from "./geometry";
import { useHistory } from "./useHistory";

const TYPE_LABEL: Record<CardElementType, string> = {
  text: "Текст",
  rect: "Прямоугольник",
  image: "Картинка",
  avatar: "Аватар",
  progress: "Прогресс-бар",
  badges: "Бейджи",
};

const ALIGN_BUTTONS: { kind: AlignKind; label: string; Icon: LucideIcon }[] = [
  { kind: "left", label: "По левому краю", Icon: AlignStartVertical },
  { kind: "hcenter", label: "По центру по горизонтали", Icon: AlignCenterVertical },
  { kind: "right", label: "По правому краю", Icon: AlignEndVertical },
  { kind: "top", label: "По верхнему краю", Icon: AlignStartHorizontal },
  { kind: "vcenter", label: "По центру по вертикали", Icon: AlignCenterHorizontal },
  { kind: "bottom", label: "По нижнему краю", Icon: AlignEndHorizontal },
];

type StageBg = "dots" | "checker" | "plain";
const STAGE_BG: { key: StageBg; label: string }[] = [
  { key: "dots", label: "Точки" },
  { key: "checker", label: "Клетка" },
  { key: "plain", label: "Сплошной" },
];

function newElement(type: CardElementType, layout: CardLayout): CardElement {
  const id = `${type}_${Date.now().toString(36)}`;
  const base = { id, name: TYPE_LABEL[type], visible: true, x: Math.round(layout.width / 2 - 100), y: Math.round(layout.height / 2 - 40), opacity: 1 };
  switch (type) {
    case "text":
      return { ...base, type, text: "Новый текст", font: "inter", weight: 600, size: 28, color: "#f2f2f2", align: "left", maxWidth: 0, uppercase: false, shadow: false };
    case "rect":
      return { ...base, type, width: 200, height: 80, radius: 12, color: "#1c1c1c" };
    case "image":
      return { ...base, type, width: 160, height: 160, radius: 0, assetId: null, fit: "contain" };
    case "avatar":
      return { ...base, type, size: 120, shape: "circle", borderWidth: 4, borderColor: "#ffffff" };
    case "progress":
      return { ...base, type, width: 400, height: 16, radius: 8, trackColor: "#2a2a2a", fillColor: "#3b82f6" };
    case "badges":
      return { ...base, type, size: 14, font: "inter", color: "#2a2a2a", textColor: "#d0d0d0", gap: 6, maxCount: 3 };
  }
}

type Status = { ok: boolean; message: string } | null;
type Gesture =
  | { kind: "move"; id: string; startP: { x: number; y: number }; startEl: CardElement; startBox: Box; targets: Guides }
  | { kind: "resize"; id: string; handle: Handle; startEl: CardElement; startBox: Box; targets: Guides };

function capture(e: ReactPointerEvent<HTMLCanvasElement>) {
  try {
    e.currentTarget.setPointerCapture(e.pointerId);
  } catch {
    // Указатель уже отпущен — перетаскивание просто закончится раньше.
  }
}

function isTyping(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  return !!el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || el.isContentEditable);
}

export function CardEditor({
  initialLayout,
  defaultLayout,
  data,
  avatarUrl,
}: {
  initialLayout: CardLayout;
  defaultLayout: CardLayout;
  data: CardData;
  avatarUrl: string;
}) {
  const history = useHistory<CardLayout>(initialLayout);
  const layout = history.value;
  const [savedJson, setSavedJson] = useState(() => JSON.stringify(initialLayout));
  const dirty = useMemo(() => JSON.stringify(layout) !== savedJson, [layout, savedJson]);

  const [selectedId, setSelectedId] = useState<string | null>(initialLayout.elements[0]?.id ?? null);
  const [tab, setTab] = useState<"elements" | "background">("elements");
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<Status>(null);
  const [snapping, setSnapping] = useState(true);
  const [stageBg, setStageBg] = useState<StageBg>("dots");
  const [redraw, setRedraw] = useState(0);
  const [cursor, setCursor] = useState("default");
  const [askReset, setAskReset] = useState(false);
  const toast = useToast();

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const images = useRef(new Map<number, HTMLImageElement>());
  const avatar = useRef<HTMLImageElement | null>(null);
  const gesture = useRef<Gesture | null>(null);
  const guides = useRef<Guides>({ xs: [], ys: [] });

  const selected = layout.elements.find((e) => e.id === selectedId) ?? null;
  const { set: setLayout, undo, redo } = history;

  const patchEl = useCallback(
    (id: string, patch: Record<string, unknown>, key = `${id}:${Object.keys(patch).sort().join(",")}`) =>
      setLayout((l) => ({ ...l, elements: l.elements.map((e) => (e.id === id ? ({ ...e, ...patch } as CardElement) : e)) }), key),
    [setLayout],
  );

  // Фон рабочей области — личная настройка, хранится в браузере.
  useEffect(() => {
    try {
      const saved = localStorage.getItem("fb-card-stage-bg") as StageBg | null;
      if (saved && STAGE_BG.some((b) => b.key === saved)) setStageBg(saved);
    } catch {
      // Хранилище недоступно — остаётся фон по умолчанию.
    }
  }, []);
  function chooseStageBg(bg: StageBg) {
    setStageBg(bg);
    try {
      localStorage.setItem("fb-card-stage-bg", bg);
    } catch {
      // Не сохранилось — не страшно.
    }
  }

  // Шрифты карточки грузим с нашего сервера, те же файлы использует бот.
  useEffect(() => {
    const faces = Object.values(CARD_FONTS).flatMap((f) =>
      Object.entries(f.files).map(([weight, file]) => new FontFace(f.family, `url(/api/card/fonts/${file})`, { weight })),
    );
    Promise.allSettled(
      faces.map(async (face) => {
        await face.load();
        document.fonts.add(face);
      }),
    ).then(() => setRedraw((n) => n + 1));
  }, []);

  useEffect(() => {
    const img = new Image();
    img.onload = () => setRedraw((n) => n + 1);
    img.src = avatarUrl;
    avatar.current = img;
  }, [avatarUrl]);

  const assetIds = useMemo(() => cardAssetIds(layout), [layout]);
  useEffect(() => {
    for (const id of assetIds) {
      if (images.current.has(id)) continue;
      const img = new Image();
      img.onload = () => setRedraw((n) => n + 1);
      img.src = `/api/card/assets/${id}`;
      images.current.set(id, img);
    }
  }, [assetIds]);

  // Масштаб: сколько пикселей карточки в одном пикселе экрана. Нужен, чтобы ручки
  // и направляющие были одного размера при любой ширине окна.
  const pxScale = useCallback(() => {
    const c = canvasRef.current;
    if (!c) return 1;
    const w = c.getBoundingClientRect().width;
    return w > 0 ? layout.width / w : 1;
  }, [layout.width]);

  // Перерисовка: карточка, направляющие, рамка и ручки выбранного элемента.
  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    canvas.width = layout.width;
    canvas.height = layout.height;
    const loaded = new Map([...images.current].filter(([, img]) => img.complete && img.naturalWidth > 0));
    const av = avatar.current?.complete && avatar.current.naturalWidth > 0 ? avatar.current : null;
    renderCard(ctx, layout, data, { avatar: av, assets: loaded });

    const s = pxScale();
    ctx.save();
    ctx.strokeStyle = "#ff3ec9";
    ctx.lineWidth = s;
    for (const x of guides.current.xs) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, layout.height);
      ctx.stroke();
    }
    for (const y of guides.current.ys) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(layout.width, y);
      ctx.stroke();
    }
    ctx.restore();

    if (selected && selected.visible) {
      const b = elementBounds(ctx, selected, data);
      ctx.save();
      ctx.strokeStyle = "#3b82f6";
      ctx.lineWidth = 1.5 * s;
      ctx.strokeRect(b.x, b.y, b.w, b.h);
      const hs = 8 * s;
      ctx.fillStyle = "#ffffff";
      ctx.lineWidth = 1.5 * s;
      for (const h of handlesFor(selected)) {
        const p = handlePoint(b, h);
        ctx.fillRect(p.x - hs / 2, p.y - hs / 2, hs, hs);
        ctx.strokeRect(p.x - hs / 2, p.y - hs / 2, hs, hs);
      }
      // Подсказка с размером или координатами во время перетаскивания.
      if (gesture.current) {
        const label = gesture.current.kind === "resize" ? `${Math.round(b.w)} × ${Math.round(b.h)}` : `${Math.round(selected.x)}, ${Math.round(selected.y)}`;
        ctx.font = `600 ${Math.round(12 * s)}px "FB Inter", sans-serif`;
        ctx.textBaseline = "top";
        ctx.textAlign = "left";
        const tw = ctx.measureText(label).width;
        const lx = b.x;
        const ly = Math.max(0, b.y - 22 * s);
        ctx.fillStyle = "#3b82f6";
        ctx.fillRect(lx, ly, tw + 12 * s, 18 * s);
        ctx.fillStyle = "#ffffff";
        ctx.fillText(label, lx + 6 * s, ly + 3 * s);
      }
      ctx.restore();
    }
  }, [layout, selected, data, redraw, pxScale]);

  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  // Ctrl+Z / Ctrl+Shift+Z / Ctrl+Y. В полях ввода работает их собственная отмена.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || isTyping(e.target)) return;
      const k = e.key.toLowerCase();
      if (k === "z" && !e.shiftKey) {
        e.preventDefault();
        undo();
      } else if ((k === "z" && e.shiftKey) || k === "y") {
        e.preventDefault();
        redo();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [undo, redo]);

  function toCard(e: ReactPointerEvent<HTMLCanvasElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    return {
      x: ((e.clientX - rect.left) / rect.width) * layout.width,
      y: ((e.clientY - rect.top) / rect.height) * layout.height,
    };
  }

  function hitElement(ctx: Ctx2D, p: { x: number; y: number }) {
    return [...layout.elements].reverse().find((el) => {
      if (!el.visible) return false;
      const b = elementBounds(ctx, el, data);
      return p.x >= b.x && p.x <= b.x + b.w && p.y >= b.y && p.y <= b.y + b.h;
    });
  }

  function onPointerDown(e: ReactPointerEvent<HTMLCanvasElement>) {
    const ctx = canvasRef.current?.getContext("2d");
    if (!ctx) return;
    const p = toCard(e);
    const tol = 7 * pxScale();

    if (selected?.visible) {
      const box = elementBounds(ctx, selected, data);
      const handle = hitHandle(box, handlesFor(selected), p, tol);
      if (handle) {
        history.checkpoint();
        gesture.current = { kind: "resize", id: selected.id, handle, startEl: selected, startBox: box, targets: snapTargets(ctx, layout, data, selected.id) };
        capture(e);
        return;
      }
    }

    const hit = hitElement(ctx, p);
    setSelectedId(hit?.id ?? null);
    if (!hit) return;
    setTab("elements");
    history.checkpoint();
    gesture.current = {
      kind: "move",
      id: hit.id,
      startP: p,
      startEl: hit,
      startBox: elementBounds(ctx, hit, data),
      targets: snapTargets(ctx, layout, data, hit.id),
    };
    capture(e);
  }

  function onPointerMove(e: ReactPointerEvent<HTMLCanvasElement>) {
    const p = toCard(e);
    const g = gesture.current;
    const tol = 6 * pxScale();
    const snap = snapping && !e.altKey;

    if (!g) {
      const ctx = canvasRef.current?.getContext("2d");
      if (!ctx) return;
      if (selected?.visible) {
        const h = hitHandle(elementBounds(ctx, selected, data), handlesFor(selected), p, 7 * pxScale());
        if (h) return setCursor(CURSOR[h]);
      }
      setCursor(hitElement(ctx, p) ? "move" : "default");
      return;
    }

    if (g.kind === "move") {
      let dx = p.x - g.startP.x;
      let dy = p.y - g.startP.y;
      if (e.shiftKey) Math.abs(dx) > Math.abs(dy) ? (dy = 0) : (dx = 0);
      const box = { ...g.startBox, x: g.startBox.x + dx, y: g.startBox.y + dy };
      if (snap) {
        const s = snapMove(box, g.targets, tol);
        dx += s.dx;
        dy += s.dy;
        guides.current = s.guides;
      } else guides.current = { xs: [], ys: [] };
      history.setSilently((l) => ({
        ...l,
        elements: l.elements.map((el) => (el.id === g.id ? ({ ...el, x: Math.round(g.startEl.x + dx), y: Math.round(g.startEl.y + dy) } as CardElement) : el)),
      }));
      return;
    }

    const r = resizeElement({ el: g.startEl, box: g.startBox }, g.handle, p, { keepRatio: e.shiftKey, targets: snap ? g.targets : null, tol });
    guides.current = r.guides;
    history.setSilently((l) => ({
      ...l,
      elements: l.elements.map((el) => (el.id === g.id ? ({ ...g.startEl, ...r.patch } as CardElement) : el)),
    }));
  }

  function endGesture() {
    if (!gesture.current) return;
    gesture.current = null;
    guides.current = { xs: [], ys: [] };
    history.dropCheckpointIfSame();
    setRedraw((n) => n + 1);
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLCanvasElement>) {
    if (!selected) return;
    if (e.key === "Delete" || e.key === "Backspace") {
      e.preventDefault();
      removeSelected();
      return;
    }
    const step = e.shiftKey ? 10 : 1;
    const moves: Record<string, [number, number]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
    const m = moves[e.key];
    if (!m) return;
    e.preventDefault();
    patchEl(selected.id, { x: selected.x + m[0], y: selected.y + m[1] }, `nudge:${selected.id}`);
  }

  function align(kind: AlignKind) {
    const ctx = canvasRef.current?.getContext("2d");
    if (!ctx || !selected) return;
    const { dx, dy } = alignOffset(elementBounds(ctx, selected, data), layout, kind);
    patchEl(selected.id, { x: Math.round(selected.x + dx), y: Math.round(selected.y + dy) }, `align:${Date.now()}`);
  }

  function moveLayer(id: string, dir: -1 | 1) {
    setLayout((l) => {
      const i = l.elements.findIndex((e) => e.id === id);
      const j = i + dir;
      if (i < 0 || j < 0 || j >= l.elements.length) return l;
      const els = [...l.elements];
      [els[i], els[j]] = [els[j]!, els[i]!];
      return { ...l, elements: els };
    });
  }

  function addElement(type: CardElementType) {
    if (layout.elements.length >= 40) {
      setStatus({ ok: false, message: "Больше 40 элементов добавить нельзя" });
      return;
    }
    const el = newElement(type, layout);
    setLayout((l) => ({ ...l, elements: [...l.elements, el] }));
    setSelectedId(el.id);
  }

  function duplicate(el: CardElement) {
    const copy = { ...el, id: `${el.type}_${Date.now().toString(36)}`, name: `${el.name} (копия)`.slice(0, 40), x: el.x + 16, y: el.y + 16 };
    setLayout((l) => ({ ...l, elements: [...l.elements, copy] }));
    setSelectedId(copy.id);
  }

  function removeSelected() {
    if (!selected) return;
    setLayout((l) => ({ ...l, elements: l.elements.filter((e) => e.id !== selected.id) }));
    setSelectedId(null);
  }

  async function upload(file: File | undefined, apply: (id: number) => void) {
    if (!file) return;
    setStatus({ ok: true, message: "Загружаю картинку…" });
    const fd = new FormData();
    fd.set("file", file);
    const res = await uploadCardAsset(fd);
    if (res.ok && res.asset) {
      apply(res.asset.id);
      setStatus(null);
      toast.show(true, "Картинка загружена. Не забудь сохранить карточку.");
    } else {
      setStatus({ ok: false, message: res.message });
    }
  }

  async function save() {
    const parsed = cardLayoutSchema.safeParse(layout);
    if (!parsed.success) {
      setStatus({ ok: false, message: `Проверь поля: ${parsed.error.issues[0]?.message ?? "ошибка в шаблоне"}` });
      return;
    }
    setSaving(true);
    const res = await saveCardLayout(JSON.stringify(parsed.data));
    setSaving(false);
    if (res?.ok) {
      setSavedJson(JSON.stringify(parsed.data));
      setStatus(null);
      toast.show(true, res.message);
    } else {
      setStatus({ ok: false, message: res?.message ?? "Не получилось сохранить" });
    }
  }

  const setBg = (patch: Partial<CardLayout["background"]>, key?: string) =>
    setLayout((l) => ({ ...l, background: { ...l.background, ...patch } }), key);

  return (
    <div className="card-editor">
      <div className="card-stage">
        <div className="editor-toolbar" role="toolbar" aria-label="Инструменты редактора">
          <div className="tool-group">
            <button type="button" className="tool-btn" onClick={undo} disabled={!history.canUndo} title="Отменить (Ctrl+Z)" aria-label="Отменить">
              <Undo2 size={16} />
            </button>
            <button type="button" className="tool-btn" onClick={redo} disabled={!history.canRedo} title="Повторить (Ctrl+Shift+Z)" aria-label="Повторить">
              <Redo2 size={16} />
            </button>
          </div>
          <div className="tool-group">
            {ALIGN_BUTTONS.map(({ kind, label, Icon }) => (
              <button key={kind} type="button" className="tool-btn" onClick={() => align(kind)} disabled={!selected} title={label} aria-label={label}>
                <Icon size={16} />
              </button>
            ))}
          </div>
          <div className="tool-group">
            <button
              type="button"
              className={snapping ? "tool-btn on" : "tool-btn"}
              onClick={() => setSnapping((v) => !v)}
              aria-pressed={snapping}
              title="Прилипание к краям, центру и другим элементам. Alt — временно отключить"
              aria-label="Прилипание"
            >
              <Magnet size={16} />
            </button>
          </div>
          <div className="tool-group tool-seg" aria-label="Фон рабочей области">
            {STAGE_BG.map((b) => (
              <button key={b.key} type="button" className={stageBg === b.key ? "tool-text on" : "tool-text"} onClick={() => chooseStageBg(b.key)} aria-pressed={stageBg === b.key}>
                {b.label}
              </button>
            ))}
          </div>
        </div>

        <div className={`card-canvas-wrap stage-${stageBg}`}>
          <canvas
            ref={canvasRef}
            className="card-canvas"
            style={{ cursor }}
            tabIndex={0}
            aria-label="Превью карточки. Нажми на элемент, чтобы выбрать, тяни за элемент или за белые ручки. Стрелки сдвигают, Delete удаляет."
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={endGesture}
            onPointerCancel={endGesture}
            onKeyDown={onKeyDown}
          />
        </div>

        <div className="card-toolbar">
          <span className="muted" style={{ fontSize: 12.5 }}>
            {layout.width}×{layout.height} · Shift — по прямой или с сохранением пропорций · Alt — без прилипания
          </span>
          <span style={{ display: "flex", gap: 8 }}>
            <button type="button" className="btn" onClick={() => setAskReset(true)}>
              Стандартная
            </button>
            <button type="button" className="btn primary" onClick={save} disabled={saving || !dirty}>
              {saving ? "Сохраняю…" : dirty ? "Сохранить" : "Сохранено"}
            </button>
          </span>
        </div>
        {status && (
          <p role="status" className={status.ok ? "form-status ok" : "form-status error"}>
            {status.message}
          </p>
        )}
        <ConfirmDialog
          open={askReset}
          title="Вернуть стандартную карточку?"
          message="Все элементы заменятся стандартными. Это можно отменить стрелкой «Отменить» до сохранения."
          confirmLabel="Вернуть"
          onCancel={() => setAskReset(false)}
          onConfirm={() => {
            setAskReset(false);
            setLayout(defaultLayout);
            setSelectedId(defaultLayout.elements[0]?.id ?? null);
          }}
        />
      </div>

      <aside className="card-inspector">
        <div className="seg">
          <button type="button" className={tab === "elements" ? "seg-btn active" : "seg-btn"} onClick={() => setTab("elements")}>
            Элементы
          </button>
          <button type="button" className={tab === "background" ? "seg-btn active" : "seg-btn"} onClick={() => setTab("background")}>
            Фон и размер
          </button>
        </div>

        {tab === "elements" && (
          <>
            <div className="layers">
              {[...layout.elements].reverse().map((el) => {
                const i = layout.elements.indexOf(el);
                return (
                  <div key={el.id} className={el.id === selectedId ? "layer active" : "layer"}>
                    <button type="button" className="layer-name" onClick={() => setSelectedId(el.id)}>
                      <span className={el.visible ? "" : "muted"}>{el.name}</span>
                      <span className="muted" style={{ fontSize: 11.5 }}>{TYPE_LABEL[el.type]}</span>
                    </button>
                    <button type="button" className="icon-btn" title={el.visible ? "Скрыть" : "Показать"} aria-label={el.visible ? "Скрыть" : "Показать"} onClick={() => patchEl(el.id, { visible: !el.visible }, `vis:${Date.now()}`)}>
                      {el.visible ? <Eye size={15} /> : <EyeOff size={15} />}
                    </button>
                    <button type="button" className="icon-btn" title="Выше" aria-label="Выше" disabled={i === layout.elements.length - 1} onClick={() => moveLayer(el.id, 1)}>
                      <ArrowUp size={15} />
                    </button>
                    <button type="button" className="icon-btn" title="Ниже" aria-label="Ниже" disabled={i === 0} onClick={() => moveLayer(el.id, -1)}>
                      <ArrowDown size={15} />
                    </button>
                  </div>
                );
              })}
            </div>

            <SelectField
              label="Добавить элемент"
              value=""
              options={[{ value: "", label: "Выбери, что добавить…" }, ...Object.entries(TYPE_LABEL).map(([value, label]) => ({ value, label }))]}
              onChange={(v) => v && addElement(v as CardElementType)}
            />

            {selected ? (
              <div className="props">
                <div className="props-head">
                  <strong>{TYPE_LABEL[selected.type]}</strong>
                  <span style={{ display: "flex", gap: 4 }}>
                    <button type="button" className="icon-btn" title="Дублировать" aria-label="Дублировать" onClick={() => duplicate(selected)}>
                      <Copy size={15} />
                    </button>
                    <button type="button" className="icon-btn danger" title="Удалить (Delete)" aria-label="Удалить" onClick={removeSelected}>
                      <Trash2 size={15} />
                    </button>
                  </span>
                </div>
                <ElementProps el={selected} patch={(p) => patchEl(selected.id, p)} upload={upload} />
              </div>
            ) : (
              <p className="muted" style={{ fontSize: 13, padding: "8px 2px" }}>
                Выбери элемент на превью или в списке.
              </p>
            )}
          </>
        )}

        {tab === "background" && (
          <div className="props">
            <Row>
              <NumField label="Ширина" value={layout.width} min={300} max={1600} onChange={(v) => setLayout((l) => ({ ...l, width: v }), "width")} />
              <NumField label="Высота" value={layout.height} min={150} max={1000} onChange={(v) => setLayout((l) => ({ ...l, height: v }), "height")} />
            </Row>
            <NumField label="Скругление углов" value={layout.radius} min={0} max={100} onChange={(v) => setLayout((l) => ({ ...l, radius: v }), "radius")} />
            <ColorField label="Цвет фона" value={layout.background.color} onChange={(v) => setBg({ color: v }, "bg-color")} />
            <div className="stack">
              <span className="prop-label">Картинка фона</span>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <label className="btn small">
                  Загрузить
                  <input
                    type="file"
                    accept="image/png,image/jpeg,image/webp"
                    hidden
                    onChange={(e) => {
                      void upload(e.target.files?.[0], (id) => setBg({ imageAssetId: id }));
                      e.target.value = "";
                    }}
                  />
                </label>
                {layout.background.imageAssetId && (
                  <button type="button" className="btn small danger" onClick={() => setBg({ imageAssetId: null })}>
                    Убрать
                  </button>
                )}
              </div>
              <span className="muted" style={{ fontSize: 12 }}>PNG, JPEG или WebP до 5 МБ. Лучше {layout.width}×{layout.height} или крупнее.</span>
            </div>
            <ColorField label="Затемнение поверх фона" value={layout.background.overlayColor} onChange={(v) => setBg({ overlayColor: v }, "bg-overlay")} />
            <NumField
              label="Сила затемнения, %"
              value={Math.round(layout.background.overlayOpacity * 100)}
              min={0}
              max={100}
              onChange={(v) => setBg({ overlayOpacity: v / 100 }, "bg-opacity")}
            />
          </div>
        )}
      </aside>
    </div>
  );
}
