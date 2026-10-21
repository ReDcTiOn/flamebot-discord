import { Plus } from "lucide-react";
import { WEEKDAYS_FULL, mapsRuleProblems, poolOf, prisma, upcomingWipes, type MapsServer, type MapsWipeRule } from "@flamebot/core";
import { ActionForm, SubmitButton } from "@/components/ActionForm";
import { EmptyState, PageHead } from "@/components/Fields";
import { ModalCancel, ModalTrigger } from "@/components/ui/Modal";
import { requirePage } from "@/lib/auth";
import { mapsView } from "@/lib/maps";
import { deleteMapsRule, saveMapsRule } from "../actions";

export const metadata = { title: "Расписание вайпов" };

const EXAMPLE_TEMPLATE = {
  embeds: [
    {
      title: "🗺️ КАРТЫ НА СЛЕДУЮЩИЙ ВАЙП",
      description: "**FR #1:** [Посмотреть]({view:1}) | [Скачать]({download:1})",
      color: 16372510,
    },
  ],
};

function RuleFields({ r, servers }: { r?: MapsWipeRule; servers: MapsServer[] }) {
  const configs = [...new Set(servers.map((s) => s.savedConfig))].sort();
  const pool = r ? poolOf(r) : {};
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

      <div className="stack">
        <span className="prop-label">Серверы</span>
        <div className="chips">
          {servers.map((s) => (
            <label key={s.id} className="check-row">
              <input type="checkbox" name="serverIds" value={s.id} defaultChecked={r?.serverIds.includes(s.id)} /> {s.title}
            </label>
          ))}
        </div>
      </div>

      <div className="stack">
        <span className="prop-label">Пул: сколько карт генерировать за раз по каждому конфигу (до 7, пусто — не генерировать)</span>
        <div className="grid grid-2">
          {configs.map((c) => (
            <label key={c} className="stack">
              <span>
                <code>{c}</code>
              </span>
              <input type="number" name={`pool:${c}`} defaultValue={pool[c] ?? ""} min={1} max={7} className="wide" />
            </label>
          ))}
        </div>
      </div>

      <label className="stack">
        <span>Шаблон анонса в Discord (JSON тела вебхука, {"{view:N}"} и {"{download:N}"} — ссылки на карту сервера N)</span>
        <textarea name="template" required rows={9} className="wide" spellCheck={false} style={{ fontFamily: "var(--mono)", fontSize: 12.5 }} defaultValue={JSON.stringify(r?.template ?? EXAMPLE_TEMPLATE, null, 2)} />
      </label>

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

export default async function MapsRulesPage() {
  await requirePage();
  const { s, fmt } = await mapsView();
  const [rules, servers] = await Promise.all([prisma.mapsWipeRule.findMany({ orderBy: [{ weekday: "asc" }, { time: "asc" }] }), prisma.mapsServer.findMany({ orderBy: { id: "asc" } })]);
  const titles = new Map(servers.map((x) => [x.id, x.title]));
  const next = upcomingWipes(rules, s.timezone, new Date(), 21);

  return (
    <>
      <PageHead title="Расписание" hint={`Когда вайпы, какие серверы и сколько карт заказывать. Время — ${s.timezoneLabel}. Изменения применяются к вайпам, где генерация ещё не начата.`}>
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
          <ActionForm action={saveMapsRule}>
            <RuleFields servers={servers} />
            <div className="modal-actions">
              <ModalCancel />
              <SubmitButton>Добавить</SubmitButton>
            </div>
          </ActionForm>
        </ModalTrigger>
      </PageHead>

      {rules.length === 0 ? (
        <EmptyState icon="clock" title="Правил нет" hint="Без правил бот не знает, когда готовить карты." />
      ) : (
        <div className="tiles">
          {rules.map((r) => {
            const problems = mapsRuleProblems(r, servers);
            const nextWipe = next.find((w) => w.rule.key === r.key);
            const pool = poolOf(r);
            return (
              <div key={r.key} className="setting" style={{ alignItems: "flex-start" }}>
                <div className="setting-body">
                  <div className="setting-title">
                    {WEEKDAYS_FULL[r.weekday]}, {r.time} <span className="muted">· {r.key}</span> {!r.enabled && <span className="chip">выключено</span>}
                  </div>
                  <div className="setting-hint">
                    Серверы: {r.serverIds.map((id) => titles.get(id) ?? `#${id}`).join(", ")}
                    <br />
                    Пул: {Object.entries(pool).map(([c, n]) => `${c} × ${n}`).join(", ") || "не задан"}
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
                    {nextWipe && (
                      <>
                        <br />
                        Ближайший: <b>{fmt(nextWipe.wipeAt)}</b>
                      </>
                    )}
                  </div>
                  {problems.length > 0 && <div className="server-error" style={{ marginTop: 8 }}>{problems.join(". ")}</div>}
                </div>
                <div className="setting-control">
                  <div className="row-actions">
                    <ModalTrigger label="Изменить" buttonClass="btn small" title={`Правило «${r.key}»`} size="lg">
                      <ActionForm action={saveMapsRule}>
                        <RuleFields r={r} servers={servers} />
                        <div className="modal-actions">
                          <ModalCancel />
                          <SubmitButton>Сохранить</SubmitButton>
                        </div>
                      </ActionForm>
                    </ModalTrigger>
                    <ActionForm action={deleteMapsRule} confirm={`Удалить правило «${r.key}»?`} confirmMessage="Уже начатые вайпы по нему доделаются, новые не начнутся." confirmLabel="Удалить" danger>
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
