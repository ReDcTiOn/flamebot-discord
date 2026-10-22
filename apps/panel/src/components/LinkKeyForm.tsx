"use client";

import { useState, useTransition, type ReactNode } from "react";
import { Copy } from "lucide-react";
import type { KeyResult } from "@/app/(panel)/link/actions";
import { useToast } from "@/components/ui/Toast";

type KeyAction = (prev: KeyResult, formData: FormData) => Promise<KeyResult>;

function CopyField({ label, value, multiline = false }: { label: string; value: string; multiline?: boolean }) {
  const toast = useToast();
  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      toast.show(true, "Скопировано");
    } catch {
      toast.show(false, "Не получилось скопировать: выдели текст и нажми Ctrl+C");
    }
  }
  return (
    <div className="stack">
      <span className="prop-label">{label}</span>
      <div style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
        {multiline ? (
          <textarea readOnly value={value} className="wide secret-input" rows={value.split("\n").length} onFocus={(e) => e.currentTarget.select()} />
        ) : (
          <input readOnly value={value} className="wide secret-input" onFocus={(e) => e.currentTarget.select()} />
        )}
        <button type="button" className="btn" onClick={copy}>
          <Copy size={14} aria-hidden="true" /> Копировать
        </button>
      </div>
    </div>
  );
}

// Форма, после которой сервер один раз отдаёт ключ API. Ключ показывается здесь же,
// пока окно открыто: в базе остаётся только его хеш, второй раз его не увидеть.
export function LinkKeyForm({
  action,
  apiUrl,
  submitLabel,
  pendingText = "Создаю ключ…",
  children,
}: {
  action: KeyAction;
  apiUrl: string;
  submitLabel: string;
  pendingText?: string;
  children?: ReactNode;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [key, setKey] = useState<string | null>(null);
  const toast = useToast();

  if (key) {
    const config = `"Адрес API": "${apiUrl}",\n"Ключ API сервера": "${key}"`;
    return (
      <div className="form-grid">
        <p className="notice warn" style={{ marginBottom: 0 }}>
          Сохрани ключ сейчас: после закрытия окна его не покажет ни панель, ни база. Потеряешь — нажми «Новый ключ».
        </p>
        <CopyField label="Ключ API сервера" value={key} />
        <CopyField label="Строки для carbon/configs/FDiscordLink.json" value={config} multiline />
        <p className="muted" style={{ fontSize: 12.5 }}>
          Вставь значения в конфиг плагина на сервере и выполни в консоли <code>c.reload FDiscordLink</code>. Проверка связи: <code>discordlink.check</code>.
        </p>
      </div>
    );
  }

  return (
    <form
      className="form-grid"
      onSubmit={(e) => {
        e.preventDefault();
        if (pending) return;
        const fd = new FormData(e.currentTarget);
        setError(null);
        startTransition(async () => {
          let res: KeyResult = null;
          try {
            res = await action(null, fd);
          } catch {
            res = { ok: false, message: "Нет связи с сервером. Попробуй ещё раз.", at: Date.now() };
          }
          if (res?.ok && res.key) {
            toast.show(true, res.message);
            setKey(res.key);
          } else setError(res?.message ?? "Не получилось. Попробуй ещё раз.");
        });
      }}
    >
      {children}
      {error && (
        <p role="alert" className="form-status error">
          {error}
        </p>
      )}
      <div className="modal-actions">
        <button type="submit" className="btn primary" disabled={pending} aria-busy={pending}>
          {pending ? pendingText : submitLabel}
        </button>
      </div>
    </form>
  );
}
