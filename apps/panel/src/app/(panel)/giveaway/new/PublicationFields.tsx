"use client";

import { useState } from "react";
import { FieldRow, Section } from "@/components/Fields";

export function ScheduleFields({ today, defaultDate, defaultTime, timezone, repeatOptions, defaultRepeat }: { today: string; defaultDate: string; defaultTime: string; timezone: string; repeatOptions: readonly { days: number; label: string }[]; defaultRepeat: number }) {
  const [scheduled, setScheduled] = useState(false);
  return (
    <Section title="Публикация" hint={`Дата и время по поясу «${timezone}».`}>
      <div className="tiles group">
        <FieldRow icon="clock" label="Когда опубликовать">
          <select name="publishMode" aria-label="Когда опубликовать" value={scheduled ? "scheduled" : "now"} onChange={e => setScheduled(e.target.value === "scheduled")}>
            <option value="now">Сразу после создания</option>
            <option value="scheduled">По расписанию</option>
          </select>
        </FieldRow>
        {scheduled ? (
          <>
            <FieldRow icon="clock" label="Дата и время старта">
              <input type="datetime-local" name="startsAt" aria-label="Дата и время старта" required />
            </FieldRow>
            <FieldRow icon="clock" label="Повторение" hint="Для серии выбери автоматические промокоды или розыгрыш без промокодов.">
              <select name="repeatEveryDays" defaultValue={defaultRepeat} aria-label="Частота повторения">
                {repeatOptions.map(option => <option key={option.days} value={option.days}>{option.label}</option>)}
              </select>
            </FieldRow>
            <FieldRow icon="clock" label="Длительность" hint="От 5 минут до года">
              <div className="row-actions">
                <input type="number" name="duration" min={1} step={1} defaultValue={24} required aria-label="Длительность" style={{ width: 85 }} />
                <select name="durationUnit" defaultValue="hours" aria-label="Единица длительности">
                  <option value="minutes">Минуты</option>
                  <option value="hours">Часы</option>
                  <option value="days">Дни</option>
                </select>
              </div>
            </FieldRow>
          </>
        ) : (
          <>
            <FieldRow icon="clock" label="Дата итогов">
              <input type="date" name="date" defaultValue={defaultDate} min={today} required aria-label="Дата итогов" />
            </FieldRow>
            <FieldRow icon="clock" label="Время итогов">
              <input type="time" name="time" defaultValue={defaultTime} required aria-label="Время итогов" />
            </FieldRow>
          </>
        )}
      </div>
    </Section>
  );
}

export function PromoFields() {
  const [mode, setMode] = useState("none");
  return (
    <Section title="Промокоды">
      <div className="tiles group">
        <FieldRow icon="ticket" label="Способ выдачи">
          <select name="promoMode" aria-label="Способ выдачи промокодов" value={mode} onChange={e => setMode(e.target.value)}>
            <option value="none">Без промокодов</option>
            <option value="manual">Вставить готовые</option>
            <option value="auto">Создать на flamerust.gg</option>
          </select>
        </FieldRow>
        {mode === "auto" && (
          <FieldRow icon="ticket" label="Сумма на победителя" hint="Бот создаст по одному одноразовому коду перед публикацией. Коды действуют до недели после запланированных итогов.">
            <div className="row-actions">
              <input type="number" name="autoPromoAmount" min={1} max={100000} step={1} defaultValue={50} required aria-label="Сумма промокода на победителя в рублях" style={{ width: 100 }} />
              <span>₽</span>
            </div>
          </FieldRow>
        )}
        {mode === "manual" && (
          <div className="setting" style={{ flexDirection: "column", alignItems: "stretch" }}>
            <label htmlFor="giveaway-codes">По одному коду на строку, по числу победителей</label>
            <textarea id="giveaway-codes" name="codes" maxLength={4000} rows={5} className="wide" spellCheck={false} autoComplete="off" required />
          </div>
        )}
      </div>
    </Section>
  );
}
