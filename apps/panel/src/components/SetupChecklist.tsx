import Link from "next/link";
import { ChevronRight, CircleCheck, CircleDashed, CircleX, History } from "lucide-react";
import { plural } from "@flamebot/core";

export interface SetupItem {
  done: boolean;
  text: string;
  // Что будет, если не настроить, — серым после названия.
  hint?: string;
  href?: string | null;
  linkLabel?: string;
  // Не просто не настроено, а мешает работе прямо сейчас.
  error?: boolean;
}

// Вместо стопки жёлтых плашек — один список того, что осталось настроить, и ошибки за сутки внизу.
// Когда всё настроено и ошибок нет, карточки нет совсем.
export function SetupChecklist({ items, problems = 0, historyHref }: { items: SetupItem[]; problems?: number; historyHref: string }) {
  const done = items.filter((i) => i.done).length;
  const left = items.length - done;
  if (left === 0 && problems === 0) return null;

  return (
    <div className="setup">
      {left > 0 && (
        <>
          <div className="setup-head">
            <span className="setup-title">Осталось настроить</span>
            <span className="setup-progress">
              {done} из {items.length}
              <span className="setup-bar" aria-hidden="true">
                <span style={{ width: `${Math.round((done / items.length) * 100)}%` }} />
              </span>
            </span>
          </div>
          {items.map((item) => (
            <div key={item.text} className={item.done ? "setup-row done" : "setup-row"}>
              {item.done ? (
                <CircleCheck size={18} className="setup-ok" aria-label="Готово" />
              ) : item.error ? (
                <CircleX size={18} className="setup-error" aria-label="Ошибка" />
              ) : (
                <CircleDashed size={18} className="setup-todo" aria-label="Не настроено" />
              )}
              <span className="setup-text">
                {item.text}
                {item.hint && !item.done && <span className="setup-hint"> — {item.hint}</span>}
              </span>
              {!item.done && item.href && (
                <Link href={item.href} className="link setup-link">
                  {item.linkLabel ?? "Настроить"} <ChevronRight size={14} aria-hidden="true" />
                </Link>
              )}
            </div>
          ))}
        </>
      )}
      {problems > 0 && (
        <div className="setup-row setup-foot">
          <History size={16} aria-hidden="true" className="setup-todo" />
          <span className="setup-text">
            За сутки {problems} {plural(problems, "предупреждение или ошибка", "предупреждения или ошибки", "предупреждений или ошибок")}
          </span>
          <Link href={historyHref} className="link setup-link">
            История <ChevronRight size={14} aria-hidden="true" />
          </Link>
        </div>
      )}
    </div>
  );
}
