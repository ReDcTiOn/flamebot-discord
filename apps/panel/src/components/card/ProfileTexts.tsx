"use client";

import { useState, type ReactNode } from "react";
import { PROFILE_TEXT_DEFAULTS, PROFILE_TEXT_PLACEHOLDERS, purchasesBlock, type ProfilePurchase, type ProfileTexts } from "@flamebot/core/card";
import { saveProfileTexts } from "@/app/(panel)/rating/actions";
import { ActionForm, SubmitButton } from "@/components/ActionForm";

const FIELDS: { key: keyof ProfileTexts; label: string }[] = [
  { key: "purchasesTitle", label: "Заголовок" },
  { key: "itemTimed", label: "Покупка со сроком" },
  { key: "itemForever", label: "Покупка навсегда" },
  { key: "itemPending", label: "Личная роль на проверке" },
  { key: "empty", label: "Если покупок нет" },
  { key: "footer", label: "Подпись внизу" },
];

const DAY = 86_400_000;
const dateFmt = new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "long", year: "numeric" });
const relFmt = new Intl.RelativeTimeFormat("ru", { numeric: "always" });

// Разметка Discord, которой хватает этому блоку: заголовки, мелкий текст, **жирный**,
// метки времени и :эмодзи:. Без вставки HTML.
function inline(text: string, now: number): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /\*\*(.+?)\*\*|<t:(\d+):([DR])>|<a?:(\w+):\d+>|:(\w{2,32}):/g;
  let last = 0;
  for (const m of text.matchAll(re)) {
    if (m.index > last) out.push(text.slice(last, m.index));
    if (m[1] !== undefined) out.push(<b key={m.index}>{m[1]}</b>);
    else if (m[2] !== undefined) {
      const ts = Number(m[2]) * 1000;
      const label = m[3] === "D" ? dateFmt.format(ts) : relFmt.format(Math.round((ts - now) / DAY), "day");
      out.push(<span key={m.index} className="dc-time">{label}</span>);
    } else out.push(<span key={m.index} className="dc-emoji" title="Эмодзи сервера">:{m[4] ?? m[5]}:</span>);
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

function DiscordText({ text, now }: { text: string; now: number }) {
  return (
    <>
      {text.split("\n").map((line, i) => {
        const h = /^(#{1,3}) (.*)$/.exec(line);
        if (h) return <div key={i} className={`dc-h${h[1]!.length}`}>{inline(h[2]!, now)}</div>;
        if (line.startsWith("-# ")) return <div key={i} className="dc-sub">{inline(line.slice(3), now)}</div>;
        return <div key={i}>{line ? inline(line, now) : " "}</div>;
      })}
    </>
  );
}

export function ProfileTextsEditor({ initial, now }: { initial: ProfileTexts; now: number }) {
  const [texts, setTexts] = useState<ProfileTexts>(initial);
  const [emptyPreview, setEmptyPreview] = useState(false);

  const sample: ProfilePurchase[] = [
    { item: "Цвет ника · Красный", price: 500, expiresAt: new Date(now + 14 * DAY), pending: false },
    { item: "VIP-роль", price: 2000, expiresAt: new Date(now + 2 * DAY), pending: false },
    { item: "Личная роль «Король скрапа»", price: 3000, expiresAt: null, pending: true },
    { item: "Бейдж «Меценат»", price: 1000, expiresAt: null, pending: false },
  ];
  const preview = purchasesBlock(texts, emptyPreview ? [] : sample);

  return (
    <ActionForm action={saveProfileTexts}>
      <div className="profile-texts">
        <div className="stack" style={{ gap: 10 }}>
          {FIELDS.map((f) => (
            <label key={f.key} className="stack">
              <span className="prop-label">{f.label}</span>
              <input
                type="text"
                name={f.key}
                value={texts[f.key]}
                maxLength={300}
                className="wide"
                placeholder={PROFILE_TEXT_DEFAULTS[f.key]}
                onChange={(e) => setTexts((t) => ({ ...t, [f.key]: e.target.value }))}
              />
            </label>
          ))}
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {PROFILE_TEXT_PLACEHOLDERS.map((p) => (
              <span key={p.key} className="chip">
                <code style={{ background: "none", padding: 0 }}>{p.key}</code> {p.label}
              </span>
            ))}
            <span className="chip">
              <code style={{ background: "none", padding: 0 }}>:имя:</code> эмодзи сервера
            </span>
          </div>
        </div>

        <div className="stack" style={{ gap: 8 }}>
          <span className="prop-label">Так будет под карточкой</span>
          <div className="dc-embed dc-profile" style={{ ["--embed" as string]: "#c9822a" }}>
            <DiscordText text={preview} now={now} />
          </div>
          <label style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 13 }}>
            <input type="checkbox" checked={emptyPreview} onChange={(e) => setEmptyPreview(e.target.checked)} />
            Показать игрока без покупок
          </label>
        </div>
      </div>
      <div className="save-bar">
        <button type="button" className="btn" onClick={() => setTexts({ ...PROFILE_TEXT_DEFAULTS })}>
          Стандартные тексты
        </button>
        <SubmitButton>Сохранить тексты</SubmitButton>
      </div>
    </ActionForm>
  );
}
