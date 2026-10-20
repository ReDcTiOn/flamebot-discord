"use client";

import { createContext, useContext, useState, useTransition, type ReactNode } from "react";
import type { ActionResult } from "@/lib/auth";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { useModal } from "@/components/ui/Modal";
import { useToast } from "@/components/ui/Toast";

type Action = (prev: ActionResult, formData: FormData) => Promise<ActionResult>;

const PendingContext = createContext(false);

// Форма с server action. Успех — уведомление в углу (и закрытие окна, если форма в окне),
// ошибка — сообщение прямо под полями, введённое не сбрасывается.
export function ActionForm({
  action,
  children,
  className,
  confirm,
  confirmLabel = "Подтвердить",
  danger = false,
  resetOnSuccess = false,
}: {
  action: Action;
  children: ReactNode;
  className?: string;
  confirm?: string;
  confirmLabel?: string;
  danger?: boolean;
  resetOnSuccess?: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [formKey, setFormKey] = useState(0);
  const [asking, setAsking] = useState<FormData | null>(null);
  const modal = useModal();
  const toast = useToast();

  // Результат обрабатываем сразу после ответа сервера: после удаления строка со страницы
  // пропадает вместе с формой, и отложенная обработка уже не успела бы показать уведомление.
  function send(fd: FormData) {
    startTransition(async () => {
      let res: ActionResult = null;
      try {
        res = await action(null, fd);
      } catch {
        res = { ok: false, message: "Нет связи с сервером. Попробуй ещё раз.", at: Date.now() };
      }
      if (res?.ok) {
        setError(null);
        toast.show(true, res.message);
        if (resetOnSuccess) setFormKey((k) => k + 1);
        modal?.close();
      } else {
        setError(res?.message ?? "Не получилось сохранить. Попробуй ещё раз.");
      }
    });
  }

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
          const fd = new FormData(e.currentTarget);
          setError(null);
          if (confirm) setAsking(fd);
          else send(fd);
        }}
        onChange={() => error && setError(null)}
      >
        {children}
        {error && (
          <p role="alert" className="form-status error">
            {error}
          </p>
        )}
      </form>
      {confirm && (
        <ConfirmDialog
          open={asking !== null}
          title={confirm}
          confirmLabel={confirmLabel}
          danger={danger}
          onCancel={() => setAsking(null)}
          onConfirm={() => {
            const fd = asking;
            setAsking(null);
            if (fd) send(fd);
          }}
        />
      )}
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
