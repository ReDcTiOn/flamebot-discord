"use client";

import { createContext, startTransition, useActionState, useContext, useEffect, useState, type ReactNode } from "react";
import type { ActionResult } from "@/lib/auth";

type Action = (prev: ActionResult, formData: FormData) => Promise<ActionResult>;

const PendingContext = createContext(false);

export function ActionForm({
  action,
  children,
  className,
  confirm,
  resetOnSuccess = false,
}: {
  action: Action;
  children: ReactNode;
  className?: string;
  confirm?: string;
  resetOnSuccess?: boolean;
}) {
  const [state, formAction, pending] = useActionState(action, null);
  const [visible, setVisible] = useState<ActionResult>(null);
  const [formKey, setFormKey] = useState(0);

  useEffect(() => {
    if (!state) return;
    setVisible(state);
    if (state.ok && resetOnSuccess) setFormKey((k) => k + 1);
    const t = setTimeout(() => setVisible(null), state.ok ? 3500 : 8000);
    return () => clearTimeout(t);
  }, [state, resetOnSuccess]);

  return (
    <PendingContext.Provider value={pending}>
      <form
        key={formKey}
        className={className}
        // Отправляем вручную, а не через action={...}: иначе React 19 после каждой отправки
        // сбрасывает поля к исходным значениям и при ошибке введённое пропадает.
        onSubmit={(e) => {
          e.preventDefault();
          if (pending) return;
          if (confirm && !window.confirm(confirm)) return;
          const fd = new FormData(e.currentTarget);
          startTransition(() => formAction(fd));
        }}
      >
        {children}
        {visible && (
          <p role="status" className={visible.ok ? "form-status ok" : "form-status error"}>
            {visible.message}
          </p>
        )}
      </form>
    </PendingContext.Provider>
  );
}

export function SubmitButton({ children, variant = "primary" }: { children: ReactNode; variant?: "primary" | "secondary" | "danger" }) {
  const pending = useContext(PendingContext);
  return (
    <button type="submit" className={`btn ${variant}`} disabled={pending} aria-busy={pending}>
      {pending ? "Сохраняю…" : children}
    </button>
  );
}
