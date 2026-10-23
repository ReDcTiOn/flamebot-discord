import Link from "next/link";
import { setBotEnabled } from "@/app/(panel)/actions";
import { ActionForm, SwitchSubmit } from "@/components/ActionForm";
import type { BotState } from "@/lib/botState";

// Включение и выключение бота. Управлять могут только администраторы сервера.
export function BotSwitch({ botKey, title, state }: { botKey: string; title: string; state: BotState }) {
  return state.enabled ? (
    <ActionForm action={setBotEnabled} confirm={`Выключить «${title}»?`} confirmMessage="Бот отключится от Discord, пока его снова не включат." confirmLabel="Выключить" danger>
      <input type="hidden" name="botKey" value={botKey} />
      <input type="hidden" name="enabled" value="off" />
      <SwitchSubmit checked label={`Выключить «${title}»`} />
    </ActionForm>
  ) : (
    <ActionForm action={setBotEnabled}>
      <input type="hidden" name="botKey" value={botKey} />
      <input type="hidden" name="enabled" value="on" />
      <SwitchSubmit checked={false} label={`Включить «${title}»`} />
    </ActionForm>
  );
}

// Точка и состояние одной строкой: «Работает · 2 д 4 ч».
export function BotStatusLine({ state }: { state: BotState }) {
  return (
    <span className={`bot-status tone-${state.tone}`}>
      <span className="bot-dot" aria-hidden="true" />
      {state.label}
      {state.tone === "on" && state.detail && <span className="bot-status-extra">· {state.detail}</span>}
    </span>
  );
}

// Состояние бота в шапке модуля: точка, состояние, причина второй строкой и переключатель.
export function BotHeaderStatus({ botKey, title, state, canControl }: { botKey: string; title: string; state: BotState; canControl: boolean }) {
  const second = state.tone === "on" ? (state.detail ? `работает ${state.detail}` : null) : state.detail;
  return (
    <div className={state.problem ? "bot-head problem" : "bot-head"}>
      <span className={`bot-dot tone-${state.tone}`} aria-hidden="true" />
      <div className="bot-head-text">
        <div className="bot-head-label">{state.label}</div>
        {second && (
          <div className="bot-head-detail" title={second}>
            {second}
          </div>
        )}
      </div>
      {state.fix && (
        <Link href={state.fix.href} className="btn small">
          {state.fix.label}
        </Link>
      )}
      {canControl && <BotSwitch botKey={botKey} title={title} state={state} />}
    </div>
  );
}
