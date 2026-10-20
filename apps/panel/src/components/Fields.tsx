import Link from "next/link";
import type { ReactNode } from "react";
import { Icon } from "@/components/Icon";
import type { listRoles } from "@/lib/guild";
import type { IconName } from "@/modules";

type Roles = Awaited<ReturnType<typeof listRoles>>;

// Плитка настройки: иконка в круге, заголовок, пояснение, управление справа.
export function FieldRow({ label, hint, icon = "layers", children }: { label: string; hint?: string; icon?: IconName; children: ReactNode }) {
  return (
    <div className="setting">
      <div className="setting-icon">
        <Icon name={icon} />
      </div>
      <div className="setting-body">
        <div className="setting-title">{label}</div>
        {hint && <div className="setting-hint">{hint}</div>}
      </div>
      <div className="setting-control">{children}</div>
    </div>
  );
}

export function Section({ title, hint, action, children }: { title: string; hint?: string; action?: ReactNode; children: ReactNode }) {
  return (
    <section className="section">
      <div className="section-head">
        <div>
          <h2>{title}</h2>
          {hint && <p>{hint}</p>}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

export function PageHead({ title, hint, children }: { title: string; hint?: string; children?: ReactNode }) {
  return (
    <div className="page-head">
      <div>
        <h1>{title}</h1>
        {hint && <p>{hint}</p>}
      </div>
      {children}
    </div>
  );
}

export function Tabs({ tabs, active, base }: { tabs: { key: string; label: string }[]; active: string; base: string }) {
  return (
    <nav className="tabs" aria-label="Разделы страницы">
      {tabs.map((t, i) => (
        <Link
          key={t.key}
          href={i === 0 ? base : `${base}?tab=${t.key}`}
          className={t.key === active ? "tab active" : "tab"}
          aria-current={t.key === active ? "page" : undefined}
        >
          {t.label}
        </Link>
      ))}
    </nav>
  );
}

export function pickTab<T extends string>(value: string | undefined, allowed: readonly T[]): T {
  return allowed.includes(value as T) ? (value as T) : allowed[0]!;
}

export function EmptyState({ icon, title, hint }: { icon: IconName; title: string; hint?: string }) {
  return (
    <div className="empty-state">
      <div className="setting-icon">
        <Icon name={icon} size={20} />
      </div>
      <strong>{title}</strong>
      {hint && <span>{hint}</span>}
    </div>
  );
}

export function Switch({ name, defaultChecked, disabled, label }: { name: string; defaultChecked?: boolean; disabled?: boolean; label: string }) {
  return (
    <span className="switch">
      <input type="checkbox" role="switch" name={name} defaultChecked={defaultChecked} disabled={disabled} aria-label={label} />
      <span />
    </span>
  );
}

export function NumberInput({
  name,
  defaultValue,
  min,
  max,
  label,
  step = 1,
  required = true,
  placeholder,
}: {
  name: string;
  defaultValue: number | null;
  min?: number;
  max?: number;
  label?: string;
  step?: number;
  required?: boolean;
  placeholder?: string;
}) {
  return (
    <input
      type="number"
      name={name}
      defaultValue={defaultValue ?? ""}
      min={min}
      max={max}
      step={step}
      required={required}
      placeholder={placeholder}
      aria-label={label}
      inputMode={step < 1 ? "decimal" : "numeric"}
    />
  );
}

// Опасные роли (с правами модерации) видны, но выбрать их нельзя.
export function RoleSelect({ name, roles, defaultValue, allowEmpty = true }: { name: string; roles: Roles; defaultValue: string | null; allowEmpty?: boolean }) {
  return (
    <select name={name} defaultValue={defaultValue ?? ""} className="wide" aria-label="Роль Discord">
      {allowEmpty && <option value="">Без роли</option>}
      {roles.map((r) => (
        <option key={r.id} value={r.id} disabled={!r.safe}>
          {r.name}
          {!r.safe ? ` — нельзя: ${r.reason?.toLowerCase()}` : ""}
        </option>
      ))}
    </select>
  );
}
