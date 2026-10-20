import { Play, Power } from "lucide-react";
import { setBotEnabled } from "@/app/(panel)/actions";
import { ActionForm, SubmitButton } from "@/components/ActionForm";
import type { BotState } from "@/lib/botState";

const TONE_CHIP = { on: "chip success", paused: "chip", pending: "chip warn", off: "chip danger" } as const;

export function BotStatusChip({ state }: { state: BotState }) {
  return (
    <span className={TONE_CHIP[state.tone]} title={state.changedByName && !state.enabled ? `Остановил: ${state.changedByName}` : undefined}>
      <span className="dot" style={{ background: "currentColor" }} />
      {state.label}
    </span>
  );
}

// Кнопка запуска и остановки бота. Управлять могут только администраторы сервера.
export function BotPower({ botKey, title, state, canControl }: { botKey: string; title: string; state: BotState; canControl: boolean }) {
  if (!canControl) return <BotStatusChip state={state} />;
  return (
    <span className="bot-power">
      <BotStatusChip state={state} />
      {state.enabled ? (
        <ActionForm
          action={setBotEnabled}
          confirm={`Остановить «${title}»? Бот отключится от Discord, пока его снова не запустят.`}
          confirmLabel="Остановить"
          danger
        >
          <input type="hidden" name="botKey" value={botKey} />
          <input type="hidden" name="enabled" value="off" />
          <SubmitButton variant="danger">
            <Power size={15} aria-hidden="true" /> Остановить
          </SubmitButton>
        </ActionForm>
      ) : (
        <ActionForm action={setBotEnabled}>
          <input type="hidden" name="botKey" value={botKey} />
          <input type="hidden" name="enabled" value="on" />
          <SubmitButton>
            <Play size={15} aria-hidden="true" /> Запустить
          </SubmitButton>
        </ActionForm>
      )}
    </span>
  );
}
