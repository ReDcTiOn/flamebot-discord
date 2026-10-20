"use client";

import { createContext, useContext, useEffect, useId, useRef, useState, type ReactNode } from "react";
import { X } from "lucide-react";

// Всплывающее окно на нативном <dialog>: фокус внутри окна, Esc и клик по фону закрывают,
// после закрытия фокус возвращается на кнопку, которая его открыла.

type ModalApi = { close: () => void };
const ModalContext = createContext<ModalApi | null>(null);

export function useModal(): ModalApi | null {
  return useContext(ModalContext);
}

export function Modal({
  open,
  onClose,
  title,
  description,
  size = "md",
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: ReactNode;
  size?: "sm" | "md" | "lg";
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      className={`modal modal-${size}`}
      aria-labelledby={titleId}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onMouseDown={(e) => {
        // Клик по затемнённому фону (сам <dialog>, а не его содержимое) закрывает окно.
        if (e.target === e.currentTarget) onClose();
      }}
    >
      {open && (
        <ModalContext.Provider value={{ close: onClose }}>
          <div className="modal-head">
            <div>
              <h2 id={titleId}>{title}</h2>
              {description && <div className="modal-desc">{description}</div>}
            </div>
            <button type="button" className="icon-btn" onClick={onClose} aria-label="Закрыть">
              <X size={18} />
            </button>
          </div>
          <div className="modal-body">{children}</div>
        </ModalContext.Provider>
      )}
    </dialog>
  );
}

// Кнопка, которая открывает окно. Содержимое окна можно рендерить на сервере.
export function ModalTrigger({
  label,
  buttonClass = "btn",
  title,
  description,
  size,
  children,
}: {
  label: ReactNode;
  buttonClass?: string;
  title: string;
  description?: ReactNode;
  size?: "sm" | "md" | "lg";
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className={buttonClass} onClick={() => setOpen(true)}>
        {label}
      </button>
      <Modal open={open} onClose={() => setOpen(false)} title={title} description={description} size={size}>
        {children}
      </Modal>
    </>
  );
}

export function ModalCancel({ children = "Отмена" }: { children?: ReactNode }) {
  const modal = useModal();
  return (
    <button type="button" className="btn" onClick={() => modal?.close()}>
      {children}
    </button>
  );
}
