"use client";

import { useState } from "react";

type ItemType = "ROLE" | "CUSTOM_ROLE" | "BADGE";

export interface ShopItemDraft {
  name: string;
  description: string;
  type: ItemType;
  price: number;
  roleId: string | null;
  durationDays: number | null;
  badgeLabel: string | null;
  enabled: boolean;
  stock: number | null;
  sortOrder: number;
}

export interface RoleOption {
  id: string;
  name: string;
  safe: boolean;
  reason?: string;
}

const TYPES: { value: ItemType; label: string; hint: string }[] = [
  { value: "ROLE", label: "Роль сервера", hint: "Готовая роль: цвет ника, доступ к каналу и т. п." },
  { value: "CUSTOM_ROLE", label: "Личная роль", hint: "Игрок сам придумывает название и цвет" },
  { value: "BADGE", label: "Бейдж", hint: "Значок в профиле и на карточке" },
];

// Поля товара. Набор полей зависит от типа, лишние не показываем.
export function ShopItemFields({ item, roles }: { item?: ShopItemDraft; roles: RoleOption[] }) {
  const [type, setType] = useState<ItemType>(item?.type ?? "ROLE");

  return (
    <div className="form-grid">
      <fieldset className="type-picker">
        <legend className="prop-label">Тип товара</legend>
        {TYPES.map((t) => (
          <label key={t.value} className="choice">
            <input type="radio" name="type" value={t.value} checked={type === t.value} onChange={() => setType(t.value)} />
            <span>
              <strong>{t.label}</strong>
              <span>{t.hint}</span>
            </span>
          </label>
        ))}
      </fieldset>

      <div className="grid grid-2">
        <label className="stack">
          <span>Название</span>
          <input type="text" name="name" defaultValue={item?.name} maxLength={80} required className="wide" placeholder="Цвет ника · 30 дней" />
        </label>
        <label className="stack">
          <span>Цена, скрап</span>
          <input type="number" name="price" defaultValue={item?.price ?? 500} min={1} required className="wide" />
        </label>
      </div>

      <label className="stack">
        <span>Описание</span>
        <input type="text" name="description" defaultValue={item?.description} maxLength={200} className="wide" placeholder="Коротко, что получит игрок" />
      </label>

      {type === "ROLE" && (
        <label className="stack">
          <span>Роль Discord</span>
          <select name="roleId" defaultValue={item?.roleId ?? ""} className="wide" required>
            <option value="" disabled>
              Выбери роль…
            </option>
            {roles.map((r) => (
              <option key={r.id} value={r.id} disabled={!r.safe}>
                {r.name}
                {!r.safe ? ` — нельзя: ${r.reason?.toLowerCase()}` : ""}
              </option>
            ))}
          </select>
        </label>
      )}

      {type === "BADGE" ? (
        <label className="stack">
          <span>Текст бейджа</span>
          <input type="text" name="badgeLabel" defaultValue={item?.badgeLabel ?? ""} maxLength={40} required className="wide" placeholder="Меценат" />
        </label>
      ) : (
        <label className="stack">
          <span>Срок, дней (пусто — навсегда)</span>
          <input type="number" name="durationDays" defaultValue={item?.durationDays ?? ""} min={1} max={3650} className="wide" placeholder="30" />
        </label>
      )}

      <div className="grid grid-2">
        <label className="stack">
          <span>Остаток (пусто — без ограничений)</span>
          <input type="number" name="stock" defaultValue={item?.stock ?? ""} min={0} className="wide" />
        </label>
        <label className="stack">
          <span>Порядок в списке</span>
          <input type="number" name="sortOrder" defaultValue={item?.sortOrder ?? 0} min={-1000} max={1000} className="wide" />
        </label>
      </div>

      <label className="check-row">
        <input type="checkbox" name="enabled" defaultChecked={item?.enabled ?? true} /> Товар в продаже
      </label>
    </div>
  );
}
