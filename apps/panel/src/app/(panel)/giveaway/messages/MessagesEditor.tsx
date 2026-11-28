"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import { Search } from "lucide-react";
import { DiscordMarkdown, type DiscordContext } from "@/components/DiscordMarkdown";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { useToast } from "@/components/ui/Toast";
import { resetGiveawayMessage, saveGiveawayMessage } from "../actions";

export type MessageValue = { text: string; enabled: boolean; format: "plain" | "embed"; title: string; color: string; footer: string };

export interface MessageDef {
  key: string;
  label: string;
  hint: string | null;
  section: string;
  optional: boolean;
  canEmbed: boolean;
  button: boolean;
  maxLength: number;
  placeholders: { key: string; desc: string }[];
  required: string[];
}

const same = (a: MessageValue, b: MessageValue) =>
  a.text === b.text &&
  a.enabled === b.enabled &&
  a.format === b.format &&
  (a.format === "plain" || (a.title === b.title && a.color === b.color && a.footer === b.footer));

const fill = (text: string, samples: Record<string, string>) => text.replace(/\{(\w+)\}/g, (m, k: string) => samples[k] ?? m);

// Строки карточки, которые показываем в живом превью сверху раздела «Карточка».
type CardState = "active" | "ended" | "cancelled";
const CARD_STATES: { key: CardState; label: string }[] = [
  { key: "active", label: "Идёт" },
  { key: "ended", label: "Итоги" },
  { key: "cancelled", label: "Отменён" },
];

export function MessagesEditor({
  defs,
  sections,
  saved: initialSaved,
  defaults,
  samples,
  ctx,
}: {
  defs: MessageDef[];
  sections: { key: string; title: string }[];
  saved: Record<string, MessageValue>;
  defaults: Record<string, MessageValue>;
  samples: Record<string, string>;
  ctx: DiscordContext;
}) {
  const [saved, setSaved] = useState(initialSaved);
  // Несохранённые правки по каждому сообщению: переключение между сообщениями их не теряет.
  const [drafts, setDrafts] = useState<Record<string, MessageValue>>({});
  const [section, setSection] = useState(sections[0]!.key);
  const [selected, setSelected] = useState(defs.find((d) => d.section === sections[0]!.key)!.key);
  const [query, setQuery] = useState("");
  const [cardState, setCardState] = useState<CardState>("active");
  const [askReset, setAskReset] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const textRef = useRef<HTMLTextAreaElement>(null);
  const toast = useToast();

  const current = (key: string) => drafts[key] ?? saved[key]!;
  const def = defs.find((d) => d.key === selected)!;
  const value = current(selected);
  const dirty = (key: string) => !!drafts[key] && !same(drafts[key]!, saved[key]!);
  const changed = (key: string) => !same(current(key), defaults[key]!);

  const q = query.trim().toLowerCase();
  const list = useMemo(
    () => (q ? defs.filter((d) => d.label.toLowerCase().includes(q) || current(d.key).text.toLowerCase().includes(q)) : defs.filter((d) => d.section === section)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [q, section, defs, drafts, saved],
  );
  const counts = Object.fromEntries(sections.map((s) => [s.key, defs.filter((d) => d.section === s.key).length]));
  const totalChanged = defs.filter((d) => changed(d.key)).length;

  function edit(patch: Partial<MessageValue>) {
    setError(null);
    setDrafts((d) => ({ ...d, [selected]: { ...current(selected), ...patch } }));
  }

  function insert(token: string) {
    const el = textRef.current;
    const text = value.text;
    const at = el ? el.selectionStart : text.length;
    const end = el ? el.selectionEnd : text.length;
    edit({ text: text.slice(0, at) + token + text.slice(end) });
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(at + token.length, at + token.length);
    });
  }

  function open(key: string) {
    setSelected(key);
    setError(null);
  }

  function save() {
    const v = value;
    startTransition(async () => {
      const res = await saveGiveawayMessage(selected, v).catch(() => null);
      if (res?.ok) {
        setSaved((s) => ({ ...s, [selected]: v }));
        setDrafts(({ [selected]: _, ...rest }) => rest);
        toast.show(true, res.message);
      } else setError(res?.message ?? "Нет связи с сервером. Попробуй ещё раз.");
    });
  }

  function reset() {
    setAskReset(false);
    startTransition(async () => {
      const res = await resetGiveawayMessage(selected).catch(() => null);
      if (res?.ok) {
        setSaved((s) => ({ ...s, [selected]: defaults[selected]! }));
        setDrafts(({ [selected]: _, ...rest }) => rest);
        toast.show(true, res.message);
      } else setError(res?.message ?? "Нет связи с сервером. Попробуй ещё раз.");
    });
  }

  const preview = (key: string) => fill(current(key).text, samples);
  const on = (key: string) => current(key).enabled;

  return (
    <div className="msg-editor">
      <nav className="msg-nav" aria-label="Разделы сообщений">
        {sections.map((s) => (
          <button
            key={s.key}
            type="button"
            className={!q && section === s.key ? "msg-nav-item active" : "msg-nav-item"}
            onClick={() => {
              setQuery("");
              setSection(s.key);
              open(defs.find((d) => d.section === s.key)!.key);
            }}
          >
            {s.title}
            <span className="msg-nav-count">{counts[s.key]}</span>
          </button>
        ))}
        <p className="msg-nav-note">«Организатору» — ответы на команды и ошибки. Обычно их не меняют.</p>
      </nav>

      <div className="msg-list-col">
        <label className="msg-search">
          <Search size={15} aria-hidden="true" />
          <input type="search" value={query} placeholder="Найти сообщение…" aria-label="Найти сообщение" onChange={(e) => setQuery(e.target.value)} />
        </label>
        <div className="muted msg-summary">Изменено {totalChanged} из {defs.length}</div>

        {!q && section === "card" && (
          <div className="msg-card-preview">
            <div className="msg-seg" role="tablist" aria-label="Состояние карточки">
              {CARD_STATES.map((s) => (
                <button key={s.key} type="button" role="tab" aria-selected={cardState === s.key} className={cardState === s.key ? "on" : ""} onClick={() => setCardState(s.key)}>
                  {s.label}
                </button>
              ))}
            </div>
            <div className="dc-message">
              {cardState === "active" && on("everyone") && <DiscordMarkdown text={preview("everyone")} ctx={ctx} />}
              <div className="dc-container" style={{ borderLeftColor: cardState === "active" ? "#ff5a1f" : cardState === "ended" ? "#68cb9a" : "#ed4245" }}>
                {cardState === "cancelled" ? (
                  <DiscordMarkdown text={preview("cancelled")} ctx={ctx} />
                ) : (
                  <>
                    <div className="dc-banner">баннер розыгрыша</div>
                    {cardState === "active" ? (
                      <>
                        <DiscordMarkdown
                          text={[on("endTime") ? preview("endTime") : "", on("boosters") ? preview("boosters") : "", on("promoHint") ? preview("promoHint") : ""].filter(Boolean).join("\n")}
                          ctx={ctx}
                        />
                        <span className="dc-button primary">🎉 {current("joinButton").text}</span>
                      </>
                    ) : (
                      <>
                        <DiscordMarkdown text={fill(current("winners").text, samples)} ctx={ctx} />
                        {on("claimHint") && <DiscordMarkdown text={preview("claimHint")} ctx={ctx} />}
                        <span className="dc-button primary">🎟 {current("claimButton").text}</span>
                      </>
                    )}
                  </>
                )}
              </div>
            </div>
          </div>
        )}

        <div className="msg-list">
          {list.length === 0 && <p className="muted" style={{ padding: 12, fontSize: 13 }}>Ничего не нашлось.</p>}
          {list.map((d) => (
            <button key={d.key} type="button" className={d.key === selected ? "msg-row active" : "msg-row"} onClick={() => open(d.key)}>
              <span className="msg-row-head">
                <span className={on(d.key) ? "" : "muted"}>{d.label}</span>
                {dirty(d.key) ? <span className="msg-badge draft">не сохранено</span> : changed(d.key) && <span className="msg-badge">изменено</span>}
              </span>
              <span className="msg-row-text">{on(d.key) ? current(d.key).text.split("\n")[0] : "выключено"}</span>
              {q && <span className="msg-row-text">{sections.find((s) => s.key === d.section)?.title}</span>}
            </button>
          ))}
        </div>
      </div>

      <div className="msg-detail">
        <div className="msg-detail-head">
          <h2>{def.label}</h2>
          {def.optional && (
            <label className="switch" title={value.enabled ? "Выключить сообщение" : "Включить сообщение"}>
              <input type="checkbox" checked={value.enabled} onChange={(e) => edit({ enabled: e.target.checked })} aria-label={`Отправлять «${def.label}»`} />
              <span />
            </label>
          )}
        </div>
        {def.hint && <p className="msg-hint">{def.hint}</p>}

        {def.canEmbed && (
          <div className="msg-seg" role="radiogroup" aria-label="Формат">
            <button type="button" role="radio" aria-checked={value.format === "plain"} className={value.format === "plain" ? "on" : ""} onClick={() => edit({ format: "plain" })}>
              Текст
            </button>
            <button type="button" role="radio" aria-checked={value.format === "embed"} className={value.format === "embed" ? "on" : ""} onClick={() => edit({ format: "embed" })}>
              Embed
            </button>
          </div>
        )}

        {value.format === "embed" && def.canEmbed && (
          <div className="msg-embed-fields">
            <label className="stack">
              <span className="prop-label">Заголовок</span>
              <input value={value.title} maxLength={256} placeholder="Необязательно" onChange={(e) => edit({ title: e.target.value })} />
            </label>
            <label className="stack">
              <span className="prop-label">Цвет полосы</span>
              <input type="color" value={value.color} onChange={(e) => edit({ color: e.target.value })} />
            </label>
            <label className="stack" style={{ gridColumn: "1 / -1" }}>
              <span className="prop-label">Подпись внизу</span>
              <input value={value.footer} maxLength={256} placeholder="Необязательно" onChange={(e) => edit({ footer: e.target.value })} />
            </label>
          </div>
        )}

        <label className="stack">
          <span className="prop-label">{def.button ? "Надпись на кнопке" : value.format === "embed" ? "Текст Embed" : "Текст"}</span>
          {def.button ? (
            <input value={value.text} maxLength={def.maxLength} onChange={(e) => edit({ text: e.target.value })} />
          ) : (
            <textarea ref={textRef} value={value.text} maxLength={def.maxLength} rows={Math.min(8, Math.max(3, value.text.split("\n").length + 1))} onChange={(e) => edit({ text: e.target.value })} />
          )}
        </label>
        <div className="msg-meta">
          <span>
            {value.text.length} / {def.maxLength}
          </span>
          {!def.button && <span>**жирный** · *курсив* · ||спойлер|| · -# мелкий · ## заголовок</span>}
        </div>

        {def.placeholders.length > 0 && (
          <div className="msg-vars">
            {def.placeholders.map((p) => (
              <button key={p.key} type="button" className="chip" title={`Вставить: ${p.desc}`} onClick={() => insert(`{${p.key}}`)}>
                <code>{`{${p.key}}`}</code> {p.desc}
                {def.required.includes(p.key) && <span className="msg-required">обязательно</span>}
              </button>
            ))}
          </div>
        )}

        <span className="prop-label">Превью в Discord</span>
        <div className="dc-message">
          {!value.enabled ? (
            <p className="muted" style={{ fontSize: 13 }}>Сообщение выключено: бот его не отправит.</p>
          ) : def.button ? (
            <span className="dc-button">{value.text}</span>
          ) : value.format === "embed" ? (
            <div className="dc-embed-box" style={{ borderLeftColor: value.color }}>
              {value.title && <div className="dc-embed-title">{fill(value.title, samples)}</div>}
              <DiscordMarkdown text={fill(value.text, samples)} ctx={ctx} />
              {value.footer && <div className="dc-embed-footer">{fill(value.footer, samples)}</div>}
            </div>
          ) : (
            <DiscordMarkdown text={fill(value.text, samples)} ctx={ctx} />
          )}
        </div>

        {error && (
          <p role="alert" className="form-status error">
            {error}
          </p>
        )}
        <div className="msg-actions">
          <button type="button" className="btn" disabled={pending || !changed(selected)} onClick={() => setAskReset(true)}>
            Вернуть стандартный
          </button>
          <button type="button" className="btn primary" disabled={pending || !dirty(selected)} onClick={save}>
            {pending ? "Сохраняю…" : dirty(selected) ? "Сохранить" : "Сохранено"}
          </button>
        </div>
      </div>

      <ConfirmDialog
        open={askReset}
        title={`Вернуть стандартный текст «${def.label}»?`}
        message={`Будет так: ${defaults[selected]!.text.split("\n")[0]}`}
        confirmLabel="Вернуть"
        onCancel={() => setAskReset(false)}
        onConfirm={reset}
      />
    </div>
  );
}
