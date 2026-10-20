"use client";

import { useEffect, useId, useRef, useState } from "react";
import { ChevronDown } from "lucide-react";

// Стандартные эмодзи под тематику Rust. Discord показывает их везде одинаково.
const GROUPS: { title: string; items: string[] }[] = [
  { title: "Ресурсы и ступени", items: ["🩲", "🌾", "🪵", "🪨", "🧱", "⚙️", "🔩", "⛓️", "🛢️", "🪙", "💰", "💎", "☢️", "🧪", "🔋", "📦"] },
  { title: "Оружие и рейд", items: ["🏹", "🪓", "⛏️", "🔨", "🔪", "🗡️", "⚔️", "🔫", "💣", "🧨", "🛡️", "🪖", "🎯", "💥"] },
  { title: "Награды", items: ["👑", "🏆", "🥇", "🥈", "🥉", "🎖️", "🏅", "⭐", "🌟", "✨", "💫", "🔱", "📈", "🚀"] },
  { title: "Стихии", items: ["🔥", "⚡", "❄️", "💧", "🌪️", "☀️", "🌙", "☄️", "🌋", "🌊"] },
  { title: "Выживание", items: ["🏠", "🏚️", "🏕️", "⛺", "🚪", "🔒", "🗝️", "🍖", "🍄", "🌲", "🌵", "🩹", "💊", "🎒", "🧭", "🗺️"] },
  { title: "Звери", items: ["🐻", "🐺", "🦌", "🐗", "🐔", "🐟", "🦈", "🦅", "🐍", "🦂"] },
  { title: "Транспорт", items: ["🚁", "🚤", "🛶", "🚗", "🏍️", "✈️", "🚂", "🛰️"] },
  { title: "Персонажи", items: ["💀", "☠️", "👻", "🤖", "👽", "😈", "🤠", "🥷", "🧙", "🧟", "🎃", "🤡"] },
];

const MAX_LENGTH = 32;

// Поле выбора эмодзи: кнопка с текущим значением и сетка стандартных эмодзи во всплывающем окне.
// Своё эмодзи можно вписать вручную. В форму уходит скрытое поле name.
export function EmojiPicker({ name, defaultValue, placeholder = "☢️", label }: { name: string; defaultValue: string | null; placeholder?: string; label: string }) {
  const [value, setValue] = useState(defaultValue ?? "");
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  const popId = useId();

  // Окно живёт в верхнем слое браузера (popover), поэтому не обрезается рамками формы.
  // Ставим его под кнопкой, а если внизу не хватает места — над ней.
  useEffect(() => {
    const pop = popRef.current;
    if (!pop) return;
    const place = (e: Event) => {
      if ((e as ToggleEvent).newState !== "open") return;
      const t = triggerRef.current?.getBoundingClientRect();
      if (!t) return;
      const width = Math.min(328, window.innerWidth - 16);
      const height = Math.min(380, window.innerHeight - 16);
      const left = Math.max(8, Math.min(t.right - width, window.innerWidth - width - 8));
      const below = t.bottom + 6 + height <= window.innerHeight - 8;
      const top = below ? t.bottom + 6 : Math.max(8, t.top - 6 - height);
      Object.assign(pop.style, { left: `${left}px`, top: `${top}px`, width: `${width}px`, maxHeight: `${height}px` });
    };
    pop.addEventListener("beforetoggle", place);
    return () => pop.removeEventListener("beforetoggle", place);
  }, []);

  const choose = (emoji: string) => {
    setValue(emoji);
    popRef.current?.hidePopover();
    triggerRef.current?.focus();
  };

  return (
    <>
      <input type="hidden" name={name} value={value} readOnly />
      <button
        ref={triggerRef}
        type="button"
        className="emoji-trigger"
        popoverTarget={popId}
        aria-label={value ? `${label}: ${value}. Изменить` : `${label}: не выбрано. Выбрать`}
        title="Выбрать эмодзи"
      >
        <span className={value ? "emoji-value" : "emoji-value muted"}>{value || placeholder}</span>
        <ChevronDown size={14} aria-hidden="true" />
      </button>
      <div
        ref={popRef}
        id={popId}
        popover="auto"
        className="emoji-pop"
        role="dialog"
        aria-label="Выбор эмодзи"
        onKeyDown={(e) => {
          // Esc закрывает только это окно, а не форму или всплывающее окно под ним.
          if (e.key === "Escape") e.stopPropagation();
        }}
      >
        <div className="emoji-pop-head">
          <input
            type="text"
            value={value}
            onChange={(e) => setValue(e.target.value.slice(0, MAX_LENGTH))}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                choose(value.trim());
              }
            }}
            maxLength={MAX_LENGTH}
            placeholder="Своё эмодзи"
            aria-label="Своё эмодзи"
          />
          <button type="button" className="btn small" onClick={() => choose("")} disabled={!value}>
            Убрать
          </button>
        </div>
        {GROUPS.map((g) => (
          <div key={g.title} className="emoji-group">
            <div className="prop-label">{g.title}</div>
            <div className="emoji-grid">
              {g.items.map((emoji) => (
                <button key={emoji} type="button" onClick={() => choose(emoji)} aria-pressed={value === emoji} title={emoji}>
                  {emoji}
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
    </>
  );
}
