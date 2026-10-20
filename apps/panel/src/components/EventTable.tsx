import Link from "next/link";
import { EVENT_GROUPS_BY_BOT, type BotEvent } from "@flamebot/core";
import { ModalTrigger } from "@/components/ui/Modal";

export const LEVEL_LABEL = { INFO: "Событие", WARN: "Предупреждение", ERROR: "Ошибка" } as const;
const LEVEL_CHIP = { INFO: "chip", WARN: "chip warn", ERROR: "chip danger" } as const;

export function eventGroup(type: string, botKey = "rating"): string {
  return EVENT_GROUPS_BY_BOT[botKey]?.[type.split(".")[0] ?? ""] ?? "Другое";
}

// Строка истории: время, важность, раздел, текст и ссылка на игрока.
export type TimelineRow = {
  key: string;
  at: Date;
  level: BotEvent["level"];
  group: string;
  message: string;
  memberId?: string | null;
  details?: unknown;
  source: "bot" | "panel";
  actor?: string;
};

export function EventTable({ rows, memberNames, showMember = true }: { rows: TimelineRow[]; memberNames: Map<string, string>; showMember?: boolean }) {
  return (
    <div className="card" style={{ padding: "8px 8px 4px" }}>
      <table className="table events-table">
        <thead>
          <tr>
            <th style={{ width: 150 }}>Когда</th>
            <th style={{ width: 130 }}>Раздел</th>
            <th>Что произошло</th>
            <th style={{ width: 1 }} />
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.key} className={`event-${r.level.toLowerCase()}`}>
              <td className="secondary" style={{ whiteSpace: "nowrap" }}>
                {r.at.toLocaleString("ru-RU")}
              </td>
              <td>
                <span className={LEVEL_CHIP[r.level]} title={LEVEL_LABEL[r.level]}>
                  <span className="dot" style={{ background: "currentColor" }} />
                  {r.group}
                </span>
              </td>
              <td>
                <div>{r.message}</div>
                <div className="muted" style={{ fontSize: 12 }}>
                  {r.source === "panel" ? `Панель · ${r.actor}` : "Бот"}
                  {showMember && r.memberId && (
                    <>
                      {" · "}
                      <Link href={`/rating/members/${r.memberId}`} className="link">
                        {memberNames.get(r.memberId) ?? r.memberId}
                      </Link>
                    </>
                  )}
                </div>
              </td>
              <td>
                {r.details != null && (
                  <ModalTrigger label="Подробнее" buttonClass="btn small" title={r.message.slice(0, 80)} description={`${LEVEL_LABEL[r.level]} · ${r.at.toLocaleString("ru-RU")}`}>
                    <pre className="json-view">{JSON.stringify(r.details, null, 2)}</pre>
                  </ModalTrigger>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
