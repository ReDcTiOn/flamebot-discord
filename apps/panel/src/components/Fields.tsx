import type { ReactNode } from "react";
import type { listRoles } from "@/lib/guild";

type Roles = Awaited<ReturnType<typeof listRoles>>;

export function FieldRow({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div className="field-row">
      <div>
        <div className="field-label">{label}</div>
        {hint && <div className="field-hint">{hint}</div>}
      </div>
      <div className="field-control">{children}</div>
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

export function NumberInput({ name, defaultValue, min, max }: { name: string; defaultValue: number | null; min?: number; max?: number }) {
  return <input type="number" name={name} defaultValue={defaultValue ?? ""} min={min} max={max} step={1} required />;
}

// Опасные роли (с правами модерации) видны, но выбрать их нельзя.
export function RoleSelect({ name, roles, defaultValue, allowEmpty = true }: { name: string; roles: Roles; defaultValue: string | null; allowEmpty?: boolean }) {
  return (
    <select name={name} defaultValue={defaultValue ?? ""} className="wide">
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
