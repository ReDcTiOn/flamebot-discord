"use client";

import type { ReactNode } from "react";
import { Modal } from "./Modal";

// Подтверждение опасного действия вместо системного window.confirm.
export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = "Подтвердить",
  danger = false,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  message?: ReactNode;
  confirmLabel?: string;
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <Modal open={open} onClose={onCancel} title={title} size="sm">
      {message && <p className="secondary" style={{ marginBottom: 4 }}>{message}</p>}
      <div className="modal-actions">
        <button type="button" className="btn" onClick={onCancel}>
          Отмена
        </button>
        <button type="button" className={danger ? "btn danger-solid" : "btn primary"} onClick={onConfirm} autoFocus>
          {confirmLabel}
        </button>
      </div>
    </Modal>
  );
}
