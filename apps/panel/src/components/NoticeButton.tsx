import type { ReactNode } from "react";
import { noticeAction } from "@/app/(panel)/notices/actions";
import { ActionForm, SubmitButton } from "@/components/ActionForm";
import type { NoticeActionKind } from "@/lib/notices";

// Кнопка задания боту объявлений: то же действие, что кнопка в Telegram.
export function NoticeButton({
  kind,
  args,
  children,
  variant = "secondary",
  confirm,
  confirmMessage,
  danger = false,
}: {
  kind: NoticeActionKind;
  args: Record<string, string | number>;
  children: ReactNode;
  variant?: "primary" | "secondary" | "danger" | "danger-solid";
  confirm?: string;
  confirmMessage?: ReactNode;
  danger?: boolean;
}) {
  return (
    <ActionForm action={noticeAction} confirm={confirm} confirmMessage={confirmMessage} confirmLabel="Да" danger={danger}>
      <input type="hidden" name="kind" value={kind} />
      {Object.entries(args).map(([k, v]) => (
        <input key={k} type="hidden" name={k} value={v} />
      ))}
      <SubmitButton variant={variant}>{children}</SubmitButton>
    </ActionForm>
  );
}
