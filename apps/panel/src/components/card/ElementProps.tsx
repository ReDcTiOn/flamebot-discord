"use client";

import { CARD_FONTS, CARD_FONT_KEYS, CARD_PLACEHOLDERS, type CardElement } from "@flamebot/core/card";
import { ColorField, NumField, Row, SelectField } from "./controls";

export function ElementProps({
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
          <SelectField
            label="Показывает"
            value={el.source}
            options={[
              { value: "level", label: "прогресс уровня" },
              { value: "rank", label: "путь до следующего ранга" },
            ]}
            onChange={(v) => patch({ source: v as "rank" | "level" })}
          />
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
