"use client";

import { useEffect, useState, type ReactNode } from "react";

export function Row({ children }: { children: ReactNode }) {
  return <div className="prop-row">{children}</div>;
}

// Числовое поле: пока человек печатает, держим строку, наружу отдаём только целое в границах.
export function NumField({ label, value, min, max, onChange }: { label: string; value: number; min: number; max: number; onChange: (v: number) => void }) {
  const [text, setText] = useState(String(value));
  useEffect(() => setText(String(value)), [value]);
  return (
    <label className="stack">
      <span className="prop-label">{label}</span>
      <input
        type="number"
        value={text}
        min={min}
        max={max}
        step={1}
        onChange={(e) => {
          setText(e.target.value);
          const n = Number.parseInt(e.target.value, 10);
          if (Number.isFinite(n)) onChange(Math.min(max, Math.max(min, n)));
        }}
        onBlur={() => setText(String(value))}
      />
    </label>
  );
}

const HEX = /^#[0-9a-fA-F]{6}$/;

export function ColorField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  const short = value.slice(0, 7);
  const [text, setText] = useState(short);
  useEffect(() => setText(short), [short]);
  return (
    <label className="stack">
      <span className="prop-label">{label}</span>
      <span className="color-field">
        <input type="color" value={HEX.test(short) ? short : "#000000"} onChange={(e) => onChange(e.target.value)} aria-label={`${label}: палитра`} />
        <input
          type="text"
          value={text}
          maxLength={7}
          onChange={(e) => {
            setText(e.target.value);
            if (HEX.test(e.target.value)) onChange(e.target.value.toLowerCase());
          }}
          onBlur={() => setText(short)}
          aria-label={`${label}: код цвета`}
        />
      </span>
    </label>
  );
}

export function SelectField({ label, value, options, onChange }: { label: string; value: string; options: { value: string; label: string }[]; onChange: (v: string) => void }) {
  return (
    <label className="stack">
      <span className="prop-label">{label}</span>
      <select value={value} onChange={(e) => onChange(e.target.value)}>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}
