"use client";

import { useActionState, useEffect, useState, type ReactNode } from "react";
import { useFormStatus } from "react-dom";
import type { ActionResult } from "@/lib/auth";

type Action = (prev: ActionResult, formData: FormData) => Promise<ActionResult>;

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
  const [state, formAction] = useActionState(action, null);
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
    <form
      key={formKey}
      action={formAction}
      className={className}
      onSubmit={(e) => {
        if (confirm && !window.confirm(confirm)) e.preventDefault();
      }}
    >
      {children}
      {visible && (
        <p role="status" className={visible.ok ? "form-status ok" : "form-status error"}>
          {visible.message}
        </p>
      )}
    </form>
  );
}

export function SubmitButton({ children, variant = "primary" }: { children: ReactNode; variant?: "primary" | "secondary" | "danger" }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className={`btn ${variant}`} disabled={pending} aria-busy={pending}>
      {pending ? "Сохраняю…" : children}
    </button>
  );
}
