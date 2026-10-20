"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { ArrowDown, ArrowUp, Copy, Eye, EyeOff, Trash2 } from "lucide-react";
import {
  CARD_FONTS,
  CARD_FONT_KEYS,
  CARD_PLACEHOLDERS,
  cardAssetIds,
  cardLayoutSchema,
  elementBounds,
  renderCard,
  type CardData,
  type CardElement,
  type CardElementType,
  type CardLayout,
} from "@flamebot/core/card";
import { saveCardLayout, uploadCardAsset } from "@/app/(panel)/rating/actions";
import { ColorField, NumField, Row, SelectField } from "./controls";

const TYPE_LABEL: Record<CardElementType, string> = {
  text: "Текст",
  rect: "Прямоугольник",
  image: "Картинка",
  avatar: "Аватар",
  progress: "Прогресс-бар",
  badges: "Бейджи",
};

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
  const [layout, setLayout] = useState<CardLayout>(initialLayout);
  const [selectedId, setSelectedId] = useState<string | null>(initialLayout.elements[0]?.id ?? null);
  const [tab, setTab] = useState<"elements" | "background">("elements");
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<Status>(null);
  const [redraw, setRedraw] = useState(0);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const images = useRef(new Map<number, HTMLImageElement>());
  const avatar = useRef<HTMLImageElement | null>(null);
  const drag = useRef<{ id: string; dx: number; dy: number } | null>(null);

  const selected = layout.elements.find((e) => e.id === selectedId) ?? null;

  const update = useCallback((fn: (l: CardLayout) => CardLayout) => {
    setLayout((l) => fn(l));
    setDirty(true);
  }, []);

  const patchEl = useCallback(
    (id: string, patch: Record<string, unknown>) =>
      update((l) => ({ ...l, elements: l.elements.map((e) => (e.id === id ? ({ ...e, ...patch } as CardElement) : e)) })),
    [update],
  );

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

  // Перерисовка превью и рамки выбранного элемента.
  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    canvas.width = layout.width;
    canvas.height = layout.height;
    const loaded = new Map([...images.current].filter(([, img]) => img.complete && img.naturalWidth > 0));
    const av = avatar.current?.complete && avatar.current.naturalWidth > 0 ? avatar.current : null;
    renderCard(ctx, layout, data, { avatar: av, assets: loaded });
    if (selected && selected.visible) {
      const b = elementBounds(ctx, selected, data);
      ctx.save();
      ctx.strokeStyle = "#3b82f6";
      ctx.lineWidth = 2;
      ctx.setLineDash([6, 4]);
      ctx.strokeRect(b.x - 4, b.y - 4, b.w + 8, b.h + 8);
      ctx.restore();
    }
  }, [layout, selected, data, redraw]);

  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  function toCard(e: ReactPointerEvent<HTMLCanvasElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    return {
      x: ((e.clientX - rect.left) / rect.width) * layout.width,
      y: ((e.clientY - rect.top) / rect.height) * layout.height,
    };
  }

  function onPointerDown(e: ReactPointerEvent<HTMLCanvasElement>) {
    const ctx = canvasRef.current?.getContext("2d");
    if (!ctx) return;
    const p = toCard(e);
    const hit = [...layout.elements].reverse().find((el) => {
      if (!el.visible) return false;
      const b = elementBounds(ctx, el, data);
      return p.x >= b.x && p.x <= b.x + b.w && p.y >= b.y && p.y <= b.y + b.h;
    });
    setSelectedId(hit?.id ?? null);
    if (hit) {
      setTab("elements");
      drag.current = { id: hit.id, dx: p.x - hit.x, dy: p.y - hit.y };
      e.currentTarget.setPointerCapture(e.pointerId);
    }
  }

  function onPointerMove(e: ReactPointerEvent<HTMLCanvasElement>) {
    if (!drag.current) return;
    const p = toCard(e);
    patchEl(drag.current.id, { x: Math.round(p.x - drag.current.dx), y: Math.round(p.y - drag.current.dy) });
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLCanvasElement>) {
    if (!selected) return;
    const step = e.shiftKey ? 10 : 1;
    const moves: Record<string, [number, number]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
    const m = moves[e.key];
    if (!m) return;
    e.preventDefault();
    patchEl(selected.id, { x: selected.x + m[0], y: selected.y + m[1] });
  }

  function moveLayer(id: string, dir: -1 | 1) {
    update((l) => {
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
    update((l) => ({ ...l, elements: [...l.elements, el] }));
    setSelectedId(el.id);
  }

  function duplicate(el: CardElement) {
    const copy = { ...el, id: `${el.type}_${Date.now().toString(36)}`, name: `${el.name} (копия)`.slice(0, 40), x: el.x + 16, y: el.y + 16 };
    update((l) => ({ ...l, elements: [...l.elements, copy] }));
    setSelectedId(copy.id);
  }

  async function upload(file: File | undefined, apply: (id: number) => void) {
    if (!file) return;
    setStatus({ ok: true, message: "Загружаю картинку…" });
    const fd = new FormData();
    fd.set("file", file);
    const res = await uploadCardAsset(fd);
    if (res?.ok && res.asset) {
      apply(res.asset.id);
      setStatus({ ok: true, message: "Картинка загружена. Не забудь сохранить карточку." });
    } else {
      setStatus({ ok: false, message: res?.message ?? "Не получилось загрузить картинку" });
    }
  }

  async function save() {
    const parsed = cardLayoutSchema.safeParse(layout);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      setStatus({ ok: false, message: `Проверь поля: ${issue?.message ?? "ошибка в шаблоне"}` });
      return;
    }
    setSaving(true);
    const res = await saveCardLayout(JSON.stringify(parsed.data));
    setSaving(false);
    setStatus(res ? { ok: res.ok, message: res.message } : null);
    if (res?.ok) setDirty(false);
  }

  return (
    <div className="card-editor">
      <div className="card-stage">
        <div className="card-canvas-wrap">
          <canvas
            ref={canvasRef}
            className="card-canvas"
            tabIndex={0}
            aria-label="Превью карточки. Нажми на элемент, чтобы выбрать, и перетащи, чтобы переместить. Стрелки сдвигают выбранный элемент."
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={() => (drag.current = null)}
            onPointerCancel={() => (drag.current = null)}
            onKeyDown={onKeyDown}
          />
        </div>
        <div className="card-toolbar">
          <span className="muted" style={{ fontSize: 12.5 }}>
            {layout.width}×{layout.height} · перетаскивай элементы мышью, стрелки сдвигают на 1 px, Shift+стрелки на 10 px
          </span>
          <span style={{ display: "flex", gap: 8 }}>
            <button
              type="button"
              className="btn"
              onClick={() => {
                if (window.confirm("Вернуть стандартную карточку? Несохранённые изменения пропадут.")) {
                  setLayout(defaultLayout);
                  setSelectedId(defaultLayout.elements[0]?.id ?? null);
                  setDirty(true);
                }
              }}
            >
              Стандартная
            </button>
            <button type="button" className="btn primary" onClick={save} disabled={saving}>
              {saving ? "Сохраняю…" : dirty ? "Сохранить" : "Сохранено"}
            </button>
          </span>
        </div>
        {status && (
          <p role="status" className={status.ok ? "form-status ok" : "form-status error"}>
            {status.message}
          </p>
        )}
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
                    <button type="button" className="icon-btn" title={el.visible ? "Скрыть" : "Показать"} aria-label={el.visible ? "Скрыть" : "Показать"} onClick={() => patchEl(el.id, { visible: !el.visible })}>
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
                    <button
                      type="button"
                      className="icon-btn danger"
                      title="Удалить"
                      aria-label="Удалить"
                      onClick={() => {
                        update((l) => ({ ...l, elements: l.elements.filter((e) => e.id !== selected.id) }));
                        setSelectedId(null);
                      }}
                    >
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
              <NumField label="Ширина" value={layout.width} min={300} max={1600} onChange={(v) => update((l) => ({ ...l, width: v }))} />
              <NumField label="Высота" value={layout.height} min={150} max={1000} onChange={(v) => update((l) => ({ ...l, height: v }))} />
            </Row>
            <NumField label="Скругление углов" value={layout.radius} min={0} max={100} onChange={(v) => update((l) => ({ ...l, radius: v }))} />
            <ColorField label="Цвет фона" value={layout.background.color} onChange={(v) => update((l) => ({ ...l, background: { ...l.background, color: v } }))} />
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
                      void upload(e.target.files?.[0], (id) => update((l) => ({ ...l, background: { ...l.background, imageAssetId: id } })));
                      e.target.value = "";
                    }}
                  />
                </label>
                {layout.background.imageAssetId && (
                  <button type="button" className="btn small danger" onClick={() => update((l) => ({ ...l, background: { ...l.background, imageAssetId: null } }))}>
                    Убрать
                  </button>
                )}
              </div>
              <span className="muted" style={{ fontSize: 12 }}>PNG, JPEG или WebP до 5 МБ. Лучше {layout.width}×{layout.height} или крупнее.</span>
            </div>
            <ColorField label="Затемнение поверх фона" value={layout.background.overlayColor} onChange={(v) => update((l) => ({ ...l, background: { ...l.background, overlayColor: v } }))} />
            <NumField
              label="Сила затемнения, %"
              value={Math.round(layout.background.overlayOpacity * 100)}
              min={0}
              max={100}
              onChange={(v) => update((l) => ({ ...l, background: { ...l.background, overlayOpacity: v / 100 } }))}
            />
          </div>
        )}
      </aside>
    </div>
  );
}

function ElementProps({
  el,
  patch,
  upload,
}: {
  el: CardElement;
  patch: (p: Record<string, unknown>) => void;
  upload: (file: File | undefined, apply: (id: number) => void) => Promise<void>;
}) {
  const fontOptions = CARD_FONT_KEYS.map((k) => ({ value: k, label: CARD_FONTS[k].label }));

  return (
    <>
      <label className="stack">
        <span className="prop-label">Название слоя</span>
        <input type="text" value={el.name} maxLength={40} onChange={(e) => patch({ name: e.target.value })} />
      </label>
      <Row>
        <NumField label="X" value={el.x} min={-2000} max={4000} onChange={(v) => patch({ x: v })} />
        <NumField label="Y" value={el.y} min={-2000} max={4000} onChange={(v) => patch({ y: v })} />
      </Row>
      <NumField label="Непрозрачность, %" value={Math.round(el.opacity * 100)} min={0} max={100} onChange={(v) => patch({ opacity: v / 100 })} />

      {el.type === "text" && (
        <>
          <label className="stack">
            <span className="prop-label">Текст</span>
            <textarea rows={2} value={el.text} maxLength={200} onChange={(e) => patch({ text: e.target.value })} />
          </label>
          <div className="placeholders">
            {CARD_PLACEHOLDERS.map((p) => (
              <button key={p.key} type="button" className="chip" title={p.label} onClick={() => patch({ text: `${el.text}${p.key}` })}>
                {p.key}
              </button>
            ))}
          </div>
          <Row>
            <SelectField label="Шрифт" value={el.font} options={fontOptions} onChange={(v) => patch({ font: v, weight: CARD_FONTS[v as keyof typeof CARD_FONTS].files[el.weight] ? el.weight : 400 })} />
            <SelectField
              label="Толщина"
              value={String(el.weight)}
              options={([400, 600, 700] as const).filter((w) => CARD_FONTS[el.font].files[w]).map((w) => ({ value: String(w), label: w === 400 ? "Обычный" : w === 600 ? "Полужирный" : "Жирный" }))}
              onChange={(v) => patch({ weight: Number(v) })}
            />
          </Row>
          <Row>
            <NumField label="Размер" value={el.size} min={8} max={200} onChange={(v) => patch({ size: v })} />
            <SelectField
              label="Выравнивание"
              value={el.align}
              options={[
                { value: "left", label: "Слева" },
                { value: "center", label: "По центру" },
                { value: "right", label: "Справа" },
              ]}
              onChange={(v) => patch({ align: v })}
            />
          </Row>
          <ColorField label="Цвет" value={el.color} onChange={(v) => patch({ color: v })} />
          <NumField label="Макс. ширина (0 — без ограничения)" value={el.maxWidth} min={0} max={4000} onChange={(v) => patch({ maxWidth: v })} />
          <label className="check-row">
            <input type="checkbox" checked={el.uppercase} onChange={(e) => patch({ uppercase: e.target.checked })} /> Заглавными буквами
          </label>
          <label className="check-row">
            <input type="checkbox" checked={el.shadow} onChange={(e) => patch({ shadow: e.target.checked })} /> Тень
          </label>
        </>
      )}

      {el.type === "rect" && (
        <>
          <Row>
            <NumField label="Ширина" value={el.width} min={1} max={4000} onChange={(v) => patch({ width: v })} />
            <NumField label="Высота" value={el.height} min={1} max={4000} onChange={(v) => patch({ height: v })} />
          </Row>
          <NumField label="Скругление" value={el.radius} min={0} max={500} onChange={(v) => patch({ radius: v })} />
          <ColorField label="Цвет" value={el.color} onChange={(v) => patch({ color: v })} />
        </>
      )}

      {el.type === "image" && (
        <>
          <div className="stack">
            <span className="prop-label">Картинка</span>
            <label className="btn small" style={{ alignSelf: "flex-start" }}>
              {el.assetId ? "Заменить" : "Загрузить"}
              <input
                type="file"
                accept="image/png,image/jpeg,image/webp"
                hidden
                onChange={(e) => {
                  void upload(e.target.files?.[0], (id) => patch({ assetId: id }));
                  e.target.value = "";
                }}
              />
            </label>
          </div>
          <Row>
            <NumField label="Ширина" value={el.width} min={1} max={4000} onChange={(v) => patch({ width: v })} />
            <NumField label="Высота" value={el.height} min={1} max={4000} onChange={(v) => patch({ height: v })} />
          </Row>
          <Row>
            <NumField label="Скругление" value={el.radius} min={0} max={500} onChange={(v) => patch({ radius: v })} />
            <SelectField
              label="Вписать"
              value={el.fit}
              options={[
                { value: "contain", label: "Целиком" },
                { value: "cover", label: "Заполнить" },
              ]}
              onChange={(v) => patch({ fit: v })}
            />
          </Row>
        </>
      )}

      {el.type === "avatar" && (
        <>
          <NumField label="Размер" value={el.size} min={1} max={800} onChange={(v) => patch({ size: v })} />
          <SelectField
            label="Форма"
            value={el.shape}
            options={[
              { value: "circle", label: "Круг" },
              { value: "rounded", label: "Скруглённый квадрат" },
              { value: "square", label: "Квадрат" },
            ]}
            onChange={(v) => patch({ shape: v })}
          />
          <NumField label="Толщина обводки" value={el.borderWidth} min={0} max={40} onChange={(v) => patch({ borderWidth: v })} />
          <ColorField label="Цвет обводки" value={el.borderColor} onChange={(v) => patch({ borderColor: v })} />
        </>
      )}

      {el.type === "progress" && (
        <>
          <Row>
            <NumField label="Ширина" value={el.width} min={1} max={4000} onChange={(v) => patch({ width: v })} />
            <NumField label="Высота" value={el.height} min={1} max={200} onChange={(v) => patch({ height: v })} />
          </Row>
          <NumField label="Скругление" value={el.radius} min={0} max={100} onChange={(v) => patch({ radius: v })} />
          <ColorField label="Цвет дорожки" value={el.trackColor} onChange={(v) => patch({ trackColor: v })} />
          <ColorField label="Цвет заполнения" value={el.fillColor} onChange={(v) => patch({ fillColor: v })} />
        </>
      )}

      {el.type === "badges" && (
        <>
          <Row>
            <NumField label="Размер текста" value={el.size} min={8} max={64} onChange={(v) => patch({ size: v })} />
            <NumField label="Сколько показывать" value={el.maxCount} min={1} max={12} onChange={(v) => patch({ maxCount: v })} />
          </Row>
          <Row>
            <SelectField label="Шрифт" value={el.font} options={fontOptions} onChange={(v) => patch({ font: v })} />
            <NumField label="Отступ" value={el.gap} min={0} max={60} onChange={(v) => patch({ gap: v })} />
          </Row>
          <ColorField label="Фон бейджа" value={el.color} onChange={(v) => patch({ color: v })} />
          <ColorField label="Цвет текста" value={el.textColor} onChange={(v) => patch({ textColor: v })} />
        </>
      )}
    </>
  );
}
