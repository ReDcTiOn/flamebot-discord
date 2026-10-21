import { Plus } from "lucide-react";
import { WEEKDAYS_FULL, WEEKDAYS_SHORT, prisma, type NoticeReminder } from "@flamebot/core";
import { ActionForm, SubmitButton } from "@/components/ActionForm";
import { EmptyState, PageHead, Section } from "@/components/Fields";
import { NoticeButton } from "@/components/NoticeButton";
import { ModalCancel, ModalTrigger } from "@/components/ui/Modal";
import { requirePage } from "@/lib/auth";
import { noticesView } from "@/lib/notices";
import { deleteNoticeReminder, saveNoticeAgenda, saveNoticeReminder, toggleNoticeAgenda } from "../actions";

export const metadata = { title: "План дня" };

const cap = (s: string) => s[0]!.toUpperCase() + s.slice(1);

function ReminderFields({ r }: { r?: NoticeReminder }) {
  return (
    <div className="form-grid">
      {r && <input type="hidden" name="originalId" value={r.id} />}
      <div className="grid" style={{ gridTemplateColumns: "2fr 1fr" }}>
        <label className="stack">
          <span>Заголовок</span>
          <input type="text" name="title" defaultValue={r?.title} required maxLength={100} className="wide" placeholder="🎁 Розыгрыш в Discord" />
        </label>
        <label className="stack">
          <span>ID (латиницей, потом не меняется)</span>
          <input type="text" name="id" defaultValue={r?.id} required maxLength={20} pattern="[a-z0-9_\-]+" readOnly={!!r} className="wide" placeholder="giveaway" />
        </label>
      </div>
      <label className="stack">
        <span>Текст (**жирный**, `код`)</span>
        <textarea name="text" defaultValue={r?.text} required rows={3} maxLength={1000} className="wide" />
      </label>
      <div className="stack">
        <span className="prop-label">Дни</span>
        <div className="chips">
          {WEEKDAYS_FULL.map((d, i) => (
            <label key={d} className="check-row">
              <input type="checkbox" name="days" value={i} defaultChecked={r?.days.includes(i)} /> {d}
            </label>
          ))}
        </div>
      </div>
      <div className="grid" style={{ gridTemplateColumns: "2fr 1fr" }}>
        <label className="stack">
          <span>Время напоминаний через запятую</span>
          <input type="text" name="times" defaultValue={r?.times.join(", ") ?? "14:00, 15:00, 16:00"} required maxLength={100} className="wide" />
        </label>
        <label className="stack">
          <span>Сколько минут ещё напоминать, если бот был выключен</span>
          <input type="number" name="graceMinutes" defaultValue={r?.graceMinutes ?? 60} min={1} max={1440} className="wide" />
        </label>
      </div>
      <div className="grid grid-2">
        <label className="stack">
          <span>Кнопка</span>
          <input type="text" name="button" defaultValue={r?.button ?? "✅ Готово"} required maxLength={40} className="wide" />
        </label>
        <label className="stack">
          <span>Ответ после нажатия</span>
          <input type="text" name="doneText" defaultValue={r?.doneText ?? "Больше сегодня не напомню."} required maxLength={200} className="wide" />
        </label>
      </div>
      <input type="hidden" name="sortOrder" value={r?.sortOrder ?? 0} />
      <label className="check-row">
        <input type="checkbox" name="enabled" defaultChecked={r?.enabled ?? true} /> Напоминание работает
      </label>
    </div>
  );
}

export default async function NoticeAgendaPage() {
  await requirePage();
  const { s } = await noticesView();
  const [days, reminders] = await Promise.all([prisma.noticeAgendaDay.findMany(), prisma.noticeReminder.findMany({ orderBy: [{ sortOrder: "asc" }, { id: "asc" }] })]);
  const items = new Map(days.map((d) => [d.weekday, d.items]));

  return (
    <>
      <PageHead title="План дня" hint={`Утром в ${s.agendaSendAt} ${s.timezoneLabel} бот присылает админам план на день, а напоминания — по своему расписанию, пока не нажмут кнопку. Время и приветствие — в «Настройках».`}>
        <ActionForm action={toggleNoticeAgenda}>
          <input type="hidden" name="enabled" value={s.agendaEnabled ? "0" : "1"} />
          <SubmitButton variant={s.agendaEnabled ? "secondary" : "primary"}>{s.agendaEnabled ? "Отключить план и напоминания" : "Включить план и напоминания"}</SubmitButton>
        </ActionForm>
      </PageHead>

      {!s.agendaEnabled && <p className="notice warn">План дня и напоминания отключены. Уведомления о вайпах работают как обычно.</p>}

      <ActionForm action={saveNoticeAgenda}>
        <Section title="Пункты плана" hint="По пункту на строку. Пустой день — в этот день план не приходит. Подстановки по вайпу этого дня: {wipe_time} — 14:00, {wipe_kind} — обычный или глобальный, {promo} — код, скидка и срок. Разметка: **жирный**, `код`.">
          <div className="tiles group">
            {WEEKDAYS_FULL.map((d, i) => (
              <div key={d} className="setting" style={{ alignItems: "flex-start" }}>
                <div className="setting-body">
                  <div className="setting-title">{cap(d)}</div>
                  <div className="setting-hint">{(items.get(i) ?? []).length ? `пунктов: ${items.get(i)!.length}` : "плана нет"}</div>
                </div>
                <div className="setting-control" style={{ flex: "1 1 60%" }}>
                  <textarea name={`day${i}`} defaultValue={(items.get(i) ?? []).join("\n")} rows={Math.max(2, (items.get(i) ?? []).length + 1)} className="wide" aria-label={`План: ${d}`} />
                </div>
              </div>
            ))}
          </div>
        </Section>
        <div className="save-bar">
          <SubmitButton>Сохранить план</SubmitButton>
        </div>
      </ActionForm>

      <Section
        title="Напоминания"
        hint="Приходят в указанное время. Нажали кнопку — остальные напоминания этого дня не придут. Если бот был выключен дольше допустимого, напоминание пропускается."
        action={
          <ModalTrigger
            label={
              <>
                <Plus size={16} aria-hidden="true" /> Добавить
              </>
            }
            buttonClass="btn small"
            title="Новое напоминание"
            size="lg"
          >
            <ActionForm action={saveNoticeReminder}>
              <ReminderFields />
              <div className="modal-actions">
                <ModalCancel />
                <SubmitButton>Добавить</SubmitButton>
              </div>
            </ActionForm>
          </ModalTrigger>
        }
      >
        {reminders.length === 0 ? (
          <EmptyState icon="clock" title="Напоминаний нет" />
        ) : (
          <div className="tiles">
            {reminders.map((r) => (
              <div key={r.id} className="setting" style={{ alignItems: "flex-start" }}>
                <div className="setting-body">
                  <div className="setting-title">
                    {r.title} <span className="muted">· {r.id}</span> {!r.enabled && <span className="chip">выключено</span>}
                  </div>
                  <div className="setting-hint">
                    {r.days.map((d) => WEEKDAYS_SHORT[d]).join(", ")} · {r.times.join(", ")} · кнопка «{r.button}»
                    <br />
                    {r.text}
                  </div>
                </div>
                <div className="setting-control">
                  <div className="row-actions">
                    <NoticeButton kind="reminder.test" args={{ id: r.id }}>
                      Проверить
                    </NoticeButton>
                    <ModalTrigger label="Изменить" buttonClass="btn small" title={r.title} size="lg">
                      <ActionForm action={saveNoticeReminder}>
                        <ReminderFields r={r} />
                        <div className="modal-actions">
                          <ModalCancel />
                          <SubmitButton>Сохранить</SubmitButton>
                        </div>
                      </ActionForm>
                    </ModalTrigger>
                    <ActionForm action={deleteNoticeReminder} confirm={`Удалить напоминание «${r.title}»?`} confirmLabel="Удалить" danger>
                      <input type="hidden" name="id" value={r.id} />
                      <SubmitButton variant="danger">Удалить</SubmitButton>
                    </ActionForm>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </Section>
    </>
  );
}
