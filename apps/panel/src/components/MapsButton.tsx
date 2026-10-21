import type { ReactNode } from "react";
import { mapsAction } from "@/app/(panel)/maps/actions";
import { ActionForm, SubmitButton } from "@/components/ActionForm";
import type { MapsActionKind } from "@/lib/maps";

// Кнопка задания боту карт: то же действие, что кнопка в Telegram.
export function MapsButton({
  kind,
  args,
  children,
  variant = "secondary",
  confirm,
  confirmMessage,
  danger = false,
}: {
  kind: MapsActionKind;
  args: Record<string, string | number>;
  children: ReactNode;
  variant?: "primary" | "secondary" | "danger" | "danger-solid";
  confirm?: string;
  confirmMessage?: ReactNode;
  danger?: boolean;
}) {
  return (
    <ActionForm action={mapsAction} confirm={confirm} confirmMessage={confirmMessage} confirmLabel="Да" danger={danger}>
      <input type="hidden" name="kind" value={kind} />
      {Object.entries(args).map(([k, v]) => (
        <input key={k} type="hidden" name={k} value={v} />
      ))}
      <SubmitButton variant={variant}>{children}</SubmitButton>
    </ActionForm>
  );
}
