import Link from "next/link";
import {
  NOTICE_KIND_ICON,
  NOTICE_KIND_LABEL,
  NOTICE_SECRETS,
  NOTICE_STATUS,
  buildPromoSpec,
  defaultTemplateId,
  fmtPromoEnd,
  noticeRuleProblems,
  noticeWipesBetween,
  prisma,
  type NoticeKind,
  type NoticeStatus,
} from "@flamebot/core";
import { ActionForm, SubmitButton } from "@/components/ActionForm";
import { AutoRefresh } from "@/components/AutoRefresh";
import { BotPower } from "@/components/BotPower";
import { EmptyState, PageHead, Section } from "@/components/Fields";
import { NoticeButton } from "@/components/NoticeButton";
import { requirePage } from "@/lib/auth";
import { getBotStates } from "@/lib/botState";
import { NOTICE_STATUS_CHIP, noticesView } from "@/lib/notices";
import { noticeAction } from "./actions";

export const metadata = { title: "Объявления о вайпах" };

const DAY = 86_400_000;

export default async function NoticesOverview() {
  const user = await requirePage();
  const { s, fmt } = await noticesView();
  const now = new Date();
  const [botState, rules, templates, secrets, images, problems] = await Promise.all([
    getBotStates(["notices"]).then((x) => x.notices!),
    prisma.noticeRule.findMany(),
    prisma.noticeTemplate.findMany({ orderBy: [{ sortOrder: "asc" }, { id: "asc" }] }),
    prisma.noticeSecret.findMany({ select: { name: true } }),
    prisma.noticeImage.findMany({ select: { kind: true } }),
    prisma.botEvent.count({ where: { botKey: "notices", level: { in: ["WARN", "ERROR"] }, createdAt: { gte: new Date(Date.now() - DAY) } } }),
  ]);
  const have = new Set(secrets.map((x) => x.name));
  const imgs = new Set(images.map((x) => x.kind));
  const missing = [
    ...NOTICE_SECRETS.filter((m) => m.required && !have.has(m.name)).map((m) => m.label),
    ...(!s.telegramAdminIds.length ? ["Telegram ID админов"] : []),
    ...(!s.vkGroupId ? ["ID сообщества ВКонтакте"] : []),
    ...(!s.gamestoresStoreId || !have.has("gamestoresSecretKey") ? ["ключи gamestores"] : []),
    ...(["regular", "global"] as const).filter((k) => !imgs.has(k)).map((k) => `картинка поста (${NOTICE_KIND_LABEL[k]})`),
  ];
  const ruleProblems = rules.filter((r) => r.enabled).flatMap((r) => noticeRuleProblems(r, templates).map((p) => `${r.key}: ${p}`));
  const byId = new Map(templates.map((t) => [t.id, t]));

  const wipes = noticeWipesBetween(rules, s.timezone, new Date(now.getTime() - s.maxLateMinutes * 60_000), new Date(now.getTime() + 8 * DAY)).slice(0, 8);
  const events = new Map((await prisma.noticeEvent.findMany({ where: { key: { in: wipes.map((w) => w.key) } } })).map((e) => [e.key, e]));
  const recent = await prisma.noticeEvent.findMany({ where: { isTest: false, status: { not: "pending" } }, orderBy: { wipeAt: "desc" }, take: 5 });

  return (
    <>
      <PageHead title="Объявления о вайпах" hint={`Время — ${s.timezoneLabel}. Всё, что здесь можно сделать, можно сделать и кнопками бота в Telegram.`}>
        <div className="head-actions">
          <AutoRefresh seconds={10} />
          <BotPower botKey="notices" title="Объявления о вайпах" state={botState} canControl={user.level === "full"} />
        </div>
      </PageHead>

      {s.dryRun && <p className="notice warn">Включён пробный режим: наружу ничего не уходит, промокоды не создаются. Выключить — в «Настройках».</p>}
      {missing.length > 0 && (
        <p className="notice warn">
          Не настроено: {missing.join(", ")}.{" "}
          <Link href={user.level === "full" ? "/notices/connection" : "/notices/settings"} className="link">
            Настроить
          </Link>
        </p>
      )}
      {ruleProblems.length > 0 && (
        <p className="notice warn">
          В расписании не выбраны тексты, по таким вайпам бот ничего не пришлёт: {ruleProblems.join("; ")}.{" "}
          <Link href="/notices/rules" className="link">Исправить</Link>
        </p>
      )}
      {problems > 0 && (
        <p className="notice warn">
          За сутки предупреждений или ошибок: {problems}.{" "}
          <Link href="/notices/events?level=problems" className="link">Открыть историю</Link>
        </p>
      )}

      <Section title="Ближайшие вайпы" hint={`Текст приходит на подтверждение за ${Math.round((s.notifyMinutes / 60) * 10) / 10} ч. Не подтвердили — в назначенное время уйдёт текст по умолчанию.`}>
        {wipes.length === 0 ? (
          <EmptyState icon="clock" title="Вайпов в ближайшие 8 дней нет" hint="Проверь правила в разделе «Расписание»." />
        ) : (
          <div className="card" style={{ padding: "8px 8px 4px" }}>
            <table className="table">
              <thead>
                <tr>
                  <th>Вайп</th>
                  <th>Текст</th>
                  <th>Промокод</th>
                  <th>Статус</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {wipes.map((w) => {
                  const ev = events.get(w.key);
                  const tpl = byId.get(ev?.templateId ?? defaultTemplateId(w.rule, w.kind) ?? "");
                  const kind = (tpl?.kind ?? w.kind) as NoticeKind;
                  const spec = tpl?.promoAmount ? buildPromoSpec(s, tpl.promoAmount, w.wipeAt) : null;
                  const notifyAt = new Date(w.wipeAt.getTime() - s.notifyMinutes * 60_000);
                  return (
                    <tr key={w.key}>
                      <td>
                        <b>{fmt(w.wipeAt)}</b>{" "}
                        <span className={kind === "global" ? "chip warn" : "chip"}>
                          {NOTICE_KIND_ICON[kind]} {NOTICE_KIND_LABEL[kind]}
                        </span>
                      </td>
                      <td className="secondary">{tpl ? tpl.title : <span className="server-error">текст не выбран</span>}</td>
                      <td className="secondary">{spec ? `${spec.code} · ${spec.amount}% · до ${fmtPromoEnd(spec.dateEnd)}` : "—"}</td>
                      <td>
                        {ev ? (
                          <>
                            <span className={NOTICE_STATUS_CHIP[ev.status] ?? "chip"}>{NOTICE_STATUS[ev.status as NoticeStatus] ?? ev.status}</span>{" "}
                            {ev.status === "pending" && (ev.confirmed ? <span className="chip success">✅ подтверждён</span> : <span className="chip warn">ждёт подтверждения</span>)}
                          </>
                        ) : (
                          <span className="muted" style={{ fontSize: 12.5 }}>
                            спросит {fmt(notifyAt)}
                          </span>
                        )}
                      </td>
                      <td style={{ width: 1, whiteSpace: "nowrap" }}>
                        {ev ? (
                          <div className="row-actions">
                            {ev.status === "pending" && !ev.confirmed && (
                              <NoticeButton kind="event.confirm" args={{ key: ev.key }} variant="primary" confirm={`Подтвердить текст «${tpl?.title ?? ev.templateId}»?`} confirmMessage="В назначенное время он уйдёт в Discord и ВКонтакте. Если тексту нужен промокод, он будет создан сейчас.">
                                Подтвердить
                              </NoticeButton>
                            )}
                            <Link href={`/notices/wipes/${encodeURIComponent(ev.key)}`} className="btn small">
                              Открыть
                            </Link>
                          </div>
                        ) : null}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      <Section title="Последние объявления" action={<Link href="/notices/wipes" className="btn small">Все вайпы</Link>}>
        {recent.length === 0 ? (
          <EmptyState icon="megaphone" title="Объявлений ещё не было" />
        ) : (
          <div className="tiles">
            {recent.map((ev) => (
              <Link key={ev.key} href={`/notices/wipes/${encodeURIComponent(ev.key)}`} className="setting" style={{ textDecoration: "none", color: "inherit" }}>
                <div className="setting-body">
                  <div className="setting-title">
                    {fmt(ev.wipeAt)} · {byId.get(ev.templateId)?.title ?? ev.templateId}
                  </div>
                </div>
                <span className={NOTICE_STATUS_CHIP[ev.status] ?? "chip"}>{NOTICE_STATUS[ev.status as NoticeStatus] ?? ev.status}</span>
              </Link>
            ))}
          </div>
        )}
      </Section>

      <Section title="Тестовый прогон" hint="«Вайп» случится через указанное число минут: придёт уведомление в Telegram, как настоящее, затем отправка — в тестовые площадки из «Подключения» или пробным прогоном, если их нет.">
        <ActionForm action={noticeAction}>
          <input type="hidden" name="kind" value="test.start" />
          <div className="row-actions" style={{ flexWrap: "wrap", alignItems: "end" }}>
            <label className="stack">
              <span>Тип вайпа</span>
              <select name="wipeKind" defaultValue="regular">
                <option value="regular">🟢 обычный</option>
                <option value="global">🔴 глобальный</option>
              </select>
            </label>
            <label className="stack">
              <span>Через, минут</span>
              <input type="number" name="minutes" defaultValue={2} min={1} max={1440} style={{ width: 100 }} />
            </label>
            <SubmitButton variant="secondary" pendingText="Запускаю…">
              Запустить тест
            </SubmitButton>
          </div>
        </ActionForm>
      </Section>
    </>
  );
}
