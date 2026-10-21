import { Plus } from "lucide-react";
import { NOTICE_KIND_LABEL, WEEKDAYS_FULL, noticeRuleProblems, noticeWipesBetween, prisma, type NoticeRule, type NoticeTemplate } from "@flamebot/core";
import { ActionForm, SubmitButton } from "@/components/ActionForm";
import { EmptyState, PageHead } from "@/components/Fields";
import { ModalCancel, ModalTrigger } from "@/components/ui/Modal";
import { requirePage } from "@/lib/auth";
import { noticesView } from "@/lib/notices";
import { deleteNoticeRule, saveNoticeRule } from "../actions";

export const metadata = { title: "Расписание объявлений" };

function TemplateSelect({ name, kind, value, templates }: { name: string; kind: "regular" | "global"; value: string | null | undefined; templates: NoticeTemplate[] }) {
  return (
    <select name={name} defaultValue={value ?? ""} className="wide">
      <option value="">— не выбран —</option>
      {templates
        .filter((t) => t.kind === kind)
        .map((t) => (
          <option key={t.id} value={t.id}>
            {t.title}
            {t.promoAmount ? ` · 🎟 ${t.promoAmount}%` : ""}
          </option>
        ))}
    </select>
  );
}

function RuleFields({ r, templates }: { r?: NoticeRule; templates: NoticeTemplate[] }) {
  const anchor = r?.bpAnchor ? r.bpAnchor.toISOString().slice(0, 10) : "";
  return (
    <div className="form-grid">
      {r && <input type="hidden" name="originalKey" value={r.key} />}
      <div className="grid" style={{ gridTemplateColumns: "1fr 1fr 120px" }}>
        <label className="stack">
          <span>Ключ (латиницей)</span>
          <input type="text" name="key" defaultValue={r?.key} required maxLength={20} pattern="[a-z0-9_\-]+" className="wide" placeholder="tuesday" />
        </label>
        <label className="stack">
          <span>День недели</span>
          <select name="weekday" defaultValue={r?.weekday ?? 1} className="wide">
            {WEEKDAYS_FULL.map((d, i) => (
              <option key={d} value={i}>
                {d}
              </option>
            ))}
          </select>
        </label>
        <label className="stack">
          <span>Время</span>
          <input type="time" name="time" defaultValue={r?.time ?? "14:00"} required className="wide" />
        </label>
      </div>

      <div className="grid grid-2">
        <label className="stack">
          <span>Текст по умолчанию: обычный вайп</span>
          <TemplateSelect name="regularTemplateId" kind="regular" value={r?.regularTemplateId} templates={templates} />
        </label>
        <label className="stack">
          <span>Текст по умолчанию: глобальный вайп</span>
          <TemplateSelect name="globalTemplateId" kind="global" value={r?.globalTemplateId} templates={templates} />
        </label>
      </div>

      <div className="grid grid-2">
        <label className="stack">
          <span>Форс-вайп: пояс в первую неделю месяца</span>
          <input type="text" name="forceTimezone" defaultValue={r?.forceTimezone ?? ""} maxLength={64} className="wide" placeholder="America/New_York" />
        </label>
        <label className="stack">
          <span>Время форс-вайпа по этому поясу</span>
          <input type="time" name="forceTime" defaultValue={r?.forceTime ?? ""} className="wide" />
        </label>
      </div>

      <div className="grid grid-2" style={{ alignItems: "end" }}>
        <label className="stack">
          <span>Глобальный вайп каждые N дней (0 — нет)</span>
          <input type="number" name="bpEveryDays" defaultValue={r?.bpEveryDays ?? 0} min={0} max={365} className="wide" />
        </label>
        <label className="stack">
          <span>Дата последнего глобального вайпа</span>
          <input type="date" name="bpAnchor" defaultValue={anchor} className="wide" />
        </label>
      </div>
      <label className="check-row">
        <input type="checkbox" name="bpFirstOfMonth" defaultChecked={r?.bpFirstOfMonth} /> Глобальный вайп в первый такой день месяца
      </label>
      <label className="check-row">
        <input type="checkbox" name="enabled" defaultChecked={r?.enabled ?? true} /> Правило работает
      </label>
    </div>
  );
}

export default async function NoticeRulesPage() {
  await requirePage();
  const { s, fmt } = await noticesView();
  const [rules, templates] = await Promise.all([
    prisma.noticeRule.findMany({ orderBy: [{ weekday: "asc" }, { time: "asc" }] }),
    prisma.noticeTemplate.findMany({ orderBy: [{ sortOrder: "asc" }, { id: "asc" }] }),
  ]);
  const titles = new Map(templates.map((t) => [t.id, t.title]));
  const next = noticeWipesBetween(rules, s.timezone, new Date(), new Date(Date.now() + 35 * 86_400_000));

  return (
    <>
      <PageHead title="Расписание" hint={`Когда вайпы и какой текст уходит по умолчанию. Время — ${s.timezoneLabel}. Глобальный вайп считается так же, как у бота карт.`}>
        <ModalTrigger
          label={
            <>
              <Plus size={16} aria-hidden="true" /> Добавить правило
            </>
          }
          buttonClass="btn primary"
          title="Новое правило"
          size="lg"
        >
          <ActionForm action={saveNoticeRule}>
            <RuleFields templates={templates} />
            <div className="modal-actions">
              <ModalCancel />
              <SubmitButton>Добавить</SubmitButton>
            </div>
          </ActionForm>
        </ModalTrigger>
      </PageHead>

      {rules.length === 0 ? (
        <EmptyState icon="clock" title="Правил нет" hint="Без правил бот не знает, когда присылать тексты." />
      ) : (
        <div className="tiles">
          {rules.map((r) => {
            const problems = r.enabled ? noticeRuleProblems(r, templates) : [];
            const upcoming = next.filter((w) => w.rule.key === r.key).slice(0, 3);
            return (
              <div key={r.key} className="setting" style={{ alignItems: "flex-start" }}>
                <div className="setting-body">
                  <div className="setting-title">
                    {WEEKDAYS_FULL[r.weekday]}, {r.time} <span className="muted">· {r.key}</span> {!r.enabled && <span className="chip">выключено</span>}
                  </div>
                  <div className="setting-hint">
                    Обычный: {r.regularTemplateId ? (titles.get(r.regularTemplateId) ?? r.regularTemplateId) : "—"}
                    {(r.bpFirstOfMonth || r.bpEveryDays > 0) && <> · глобальный: {r.globalTemplateId ? (titles.get(r.globalTemplateId) ?? r.globalTemplateId) : "—"}</>}
                    {r.forceTimezone && (
                      <>
                        <br />В первую неделю месяца — {r.forceTime} по {r.forceTimezone}
                      </>
                    )}
                    {(r.bpFirstOfMonth || r.bpEveryDays > 0) && (
                      <>
                        <br />
                        Глобальный: {[r.bpFirstOfMonth ? "первый в месяце" : null, r.bpEveryDays ? `каждые ${r.bpEveryDays} дн. от ${r.bpAnchor?.toISOString().slice(0, 10)}` : null].filter(Boolean).join(", ")}
                      </>
                    )}
                    {upcoming.length > 0 && (
                      <>
                        <br />
                        Ближайшие: {upcoming.map((w) => `${fmt(w.wipeAt)} (${NOTICE_KIND_LABEL[w.kind]})`).join(", ")}
                      </>
                    )}
                  </div>
                  {problems.length > 0 && <div className="server-error" style={{ marginTop: 8 }}>{problems.join(". ")}</div>}
                </div>
                <div className="setting-control">
                  <div className="row-actions">
                    <ModalTrigger label="Изменить" buttonClass="btn small" title={`Правило «${r.key}»`} size="lg">
                      <ActionForm action={saveNoticeRule}>
                        <RuleFields r={r} templates={templates} />
                        <div className="modal-actions">
                          <ModalCancel />
                          <SubmitButton>Сохранить</SubmitButton>
                        </div>
                      </ActionForm>
                    </ModalTrigger>
                    <ActionForm action={deleteNoticeRule} confirm={`Удалить правило «${r.key}»?`} confirmMessage="Вайпы, о которых бот уже спросил, остаются. Новые по этому правилу не появятся." confirmLabel="Удалить" danger>
                      <input type="hidden" name="key" value={r.key} />
                      <SubmitButton variant="danger">Удалить</SubmitButton>
                    </ActionForm>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}
