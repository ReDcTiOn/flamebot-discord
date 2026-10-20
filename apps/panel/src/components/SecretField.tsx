"use client";

import { useState } from "react";
import { KeyRound } from "lucide-react";

// Поле для секрета (токен, пароль). Пока вводишь — текст виден. После сохранения
// сервер не отдаёт значение обратно: здесь только отметка «сохранён» и кнопка «Заменить».
// Пустое поле при сохранении означает «оставить прежний секрет».
export function SecretField({
  name,
  label,
  placeholder,
  saved,
  savedAt,
  required = false,
}: {
  name: string;
  label: string;
  placeholder?: string;
  saved: boolean;
  savedAt?: string | null;
  required?: boolean;
}) {
  const [editing, setEditing] = useState(!saved);

  return (
    <div className="stack">
      <span className="prop-label">{label}</span>
      {editing ? (
        <div style={{ display: "flex", gap: 8 }}>
          <input
            type="text"
            name={name}
            className="wide secret-input"
            placeholder={placeholder}
            required={required && !saved}
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="off"
            spellCheck={false}
            data-1p-ignore
            data-lpignore="true"
            maxLength={200}
          />
          {saved && (
            <button type="button" className="btn" onClick={() => setEditing(false)}>
              Отмена
            </button>
          )}
        </div>
      ) : (
        <div className="secret-saved">
          <KeyRound size={15} aria-hidden="true" />
          <span>
            Сохранён{savedAt ? ` · обновлён ${savedAt}` : ""}. Посмотреть нельзя, только заменить.
          </span>
          <button type="button" className="btn small" onClick={() => setEditing(true)}>
            Заменить
          </button>
        </div>
      )}
    </div>
  );
}
