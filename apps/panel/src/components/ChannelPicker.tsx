"use client";

import { useRef, useState } from "react";

// Список каналов с галочками и кнопками «отметить все» и «снять все».
export function ChannelPicker({
  name,
  channels,
  defaultSelected,
}: {
  name: string;
  channels: { id: string; name: string }[];
  defaultSelected: string[];
}) {
  const listRef = useRef<HTMLDivElement>(null);
  const [count, setCount] = useState(defaultSelected.length);

  function setAll(checked: boolean) {
    listRef.current?.querySelectorAll<HTMLInputElement>(`input[name="${name}"]`).forEach((i) => (i.checked = checked));
    setCount(checked ? channels.length : 0);
  }

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
        <span className="muted" style={{ fontSize: 12.5, marginRight: "auto" }}>
          Выбрано: {count} из {channels.length}
        </span>
        <button type="button" className="btn small" onClick={() => setAll(true)}>
          Отметить все
        </button>
        <button type="button" className="btn small" onClick={() => setAll(false)}>
          Снять все
        </button>
      </div>
      <div
        className="check-list"
        ref={listRef}
        onChange={() => setCount(listRef.current?.querySelectorAll(`input[name="${name}"]:checked`).length ?? 0)}
      >
        {channels.map((c) => (
          <label key={c.id} className="check-item">
            <input type="checkbox" name={name} value={c.id} defaultChecked={defaultSelected.includes(c.id)} />
            # {c.name}
          </label>
        ))}
      </div>
    </div>
  );
}
