"use client";

import { useState } from "react";

export function MessageEditor({ field, label, saved, canEmbed, maxLength, rows }: {
  field: string;
  label: string;
  saved: { format: "plain" | "embed"; text: string; title: string; color: string; footer: string };
  canEmbed: boolean;
  maxLength: number;
  rows: number;
}) {
  const [format, setFormat] = useState(saved.format);
  const embed = canEmbed && format === "embed";

  return (
    <div className="stack" style={{ gap: 8 }}>
      {canEmbed && (
        <label className="stack" style={{ gap: 4 }}>
          <span className="prop-label">Формат</span>
          <select name={`${field}Format`} aria-label={`Формат сообщения «${label}»`} value={format}
            onChange={e => setFormat(e.target.value === "embed" ? "embed" : "plain")}>
            <option value="plain">Обычное сообщение</option>
            <option value="embed">Embed</option>
          </select>
        </label>
      )}
      {canEmbed && (
        <div hidden={!embed}>
          <div className="form-grid">
            <label className="stack">
              <span className="prop-label">Заголовок Embed</span>
              <input name={`${field}Title`} className="wide" defaultValue={saved.title} maxLength={256} placeholder="Необязательно" />
            </label>
            <label className="stack">
              <span className="prop-label">Цвет боковой полосы</span>
              <input type="color" name={`${field}Color`} defaultValue={saved.color} />
            </label>
            <label className="stack">
              <span className="prop-label">Подпись Embed</span>
              <input name={`${field}Footer`} className="wide" defaultValue={saved.footer} maxLength={256} placeholder="Необязательно" />
            </label>
          </div>
        </div>
      )}
      {embed && <div className="setting-hint">Основной текст станет описанием Embed. В нём работают Markdown и подстановки. Для мелкого текста внизу используй подпись.</div>}
      <textarea id={field} name={field} className="wide" defaultValue={saved.text} maxLength={maxLength} rows={rows} required />
    </div>
  );
}
