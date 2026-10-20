"use client";

import { useId, useRef, useState, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import { ModalProvider } from "@/components/ui/Modal";

// Строка списка, под которой по стрелке раскрывается форма редактирования.
// «Отмена», Esc и успешное сохранение сворачивают форму, фокус возвращается на стрелку.
export function ExpandableRow({
  icon,
  title,
  hint,
  actions,
  toggleLabel,
  children,
}: {
  icon: ReactNode;
  title: ReactNode;
  hint?: ReactNode;
  actions?: ReactNode;
  toggleLabel: string;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const toggleRef = useRef<HTMLButtonElement>(null);
  const close = () => {
    setOpen(false);
    toggleRef.current?.focus();
  };

  return (
    <div className={open ? "expandable open" : "expandable"}>
      <div className="setting">
        {icon}
        <div className="setting-body">
          <div className="setting-title">{title}</div>
          {hint && <div className="setting-hint">{hint}</div>}
        </div>
        <div className="row-actions">
          <button
            ref={toggleRef}
            type="button"
            className="icon-btn bordered expand-toggle"
            aria-expanded={open}
            aria-controls={panelId}
            title={toggleLabel}
            aria-label={toggleLabel}
            onClick={() => setOpen((v) => !v)}
          >
            <ChevronDown size={16} aria-hidden="true" />
          </button>
          {actions}
        </div>
      </div>
      <div
        id={panelId}
        className="expandable-panel"
        hidden={!open}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.stopPropagation();
            close();
          }
        }}
      >
        {/* Форма монтируется заново при каждом раскрытии: несохранённые правки не остаются. */}
        {open && <ModalProvider value={{ close }}>{children}</ModalProvider>}
      </div>
    </div>
  );
}
