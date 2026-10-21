import Link from "next/link";
import { notFound } from "next/navigation";
import {
  NOTICE_KIND_ICON,
  NOTICE_KIND_LABEL,
  NOTICE_KIND_NOTE,
  NOTICE_STATUS,
  buildPromoSpec,
  fmtPromoEnd,
  prisma,
  renderNotice,
  type NoticeKind,
  type NoticeStatus,
} from "@flamebot/core";
import { ActionForm, SubmitButton } from "@/components/ActionForm";
import { AutoRefresh } from "@/components/AutoRefresh";
import { EmptyState, PageHead, Section } from "@/components/Fields";
import { NoticeButton } from "@/components/NoticeButton";
import { PostPreview } from "@/components/notices/PostPreview";
import { requirePage } from "@/lib/auth";
import { NOTICE_STATUS_CHIP, RESULT_CHIP, noticesView } from "@/lib/notices";
import { noticeAction } from "../../actions";

export const metadata = { title: "Вайп" };

interface Result {
  state: string;
  detail?: string;
  text?: string;
  code?: string;
  amount?: number;
  dateEnd?: string;
}
const RESULT_TEXT: Record<string, string> = { ok: "отправлено", dry: "пробный прогон, наружу ничего не ушло", error: "ошибка", warn: "внимание", none: "не нужен" };

export default async function NoticeWipePage({ params }: { params: Promise<{ key: string }> }) {
  await requirePage();
  const key = decodeURIComponent((await params).key);
  const { s, fmt } = await noticesView();
  const [ev, templates, images] = await Promise.all([
    prisma.noticeEvent.findUnique({ where: { key } }),
    prisma.noticeTemplate.findMany({ orderBy: [{ sortOrder: "asc" }, { id: "asc" }] }),
    prisma.noticeImage.findMany({ select: { kind: true, updatedAt: true } }),
  ]);
  if (!ev) notFound();
  const tpl = templates.find((t) => t.id === ev.templateId);
  const kind = ev.kind as NoticeKind;
  const img = images.find((i) => i.kind === (tpl?.kind ?? kind));
  const rendered = tpl ? renderNotice(tpl, ev.wipeAt, s.timezone) : null;
  const results = (ev.results ?? {}) as Record<string, Result | undefined>;
  const promo = ev.promo as { code: string; amount: number; date_end: string; id: number | null } | null;
  const spec = tpl?.promoAmount ? buildPromoSpec(s, tpl.promoAmount, ev.wipeAt) : null;
  const pending = ev.status === "pending";
  const by = ev.confirmedBy?.replace(/ \(панель\)$/, "");

  return (
    <>
      <PageHead title={`Вайп ${fmt(ev.wipeAt)}`} hint={ev.isTest ? "Тестовый прогон: отправка идёт в тестовые площадки или пробным прогоном." : undefined}>
        <div className="head-actions">
          {pending && <AutoRefresh seconds={10} />}
          <Link href="/notices/wipes" className="btn small">Все вайпы</Link>
        </div>
      </PageHead>

      <div className="tiles group" style={{ marginBottom: 18 }}>
        <div className="setting">
          <div className="setting-body">
            <div className="setting-title">
              {NOTICE_KIND_ICON[kind]} {NOTICE_KIND_LABEL[kind]} вайп · {NOTICE_KIND_NOTE[kind]}
            </div>
            <div className="setting-hint">
              Текст: <b>{tpl?.title ?? `«${ev.templateId}» (удалён)`}</b>
              {pending && (ev.confirmed ? ` · подтвердил ${by ?? "?"}` : " · ещё не подтверждён: без подтверждения уйдёт этот текст")}
            </div>
          </div>
          <div className="setting-control">
            <span className={NOTICE_STATUS_CHIP[ev.status] ?? "chip"}>{NOTICE_STATUS[ev.status as NoticeStatus] ?? ev.status}</span>
          </div>
        </div>
        <div className="setting">
          <div className="setting-body">
            <div className="setting-title">Промокод</div>
            <div className="setting-hint">
              {promo
                ? `${promo.code} · ${promo.amount}% · до ${fmtPromoEnd(promo.date_end)} — ${promo.id ? "создан ботом" : "уже был в магазине"}`
                : spec
                  ? s.dryRun || (ev.isTest && !s.promoTestReal)
                    ? `${spec.code} · ${spec.amount}% — пробный прогон, промокод не создаётся`
                    : ev.isTest
                      ? `тестовый TEST-${spec.code}-… · 1% · одно использование — создастся при подтверждении`
                      : `${spec.code} · ${spec.amount}% · до ${fmtPromoEnd(spec.dateEnd)} — ${ev.confirmed ? "создастся перед отправкой" : "создастся при подтверждении"}`
                  : "этому тексту не нужен"}
              {promo && spec && (promo.amount !== spec.amount || promo.date_end !== spec.dateEnd) && " · при подтверждении заменится"}
              {promo && !spec && pending && " · при подтверждении удалится"}
            </div>
          </div>
        </div>
      </div>

      {pending && (
        <Section title="Действия" hint="Те же кнопки, что в Telegram. Карточки у админов в Telegram обновятся сами.">
          <div className="row-actions" style={{ flexWrap: "wrap", alignItems: "end" }}>
            {!ev.confirmed && (
              <NoticeButton kind="event.confirm" args={{ key: ev.key }} variant="primary" confirm={`Подтвердить текст «${tpl?.title ?? ev.templateId}»?`} confirmMessage="В назначенное время он уйдёт в Discord и ВКонтакте. Если тексту нужен промокод, он будет создан сейчас.">
                Подтвердить
              </NoticeButton>
            )}
            <ActionForm action={noticeAction}>
              <input type="hidden" name="kind" value="event.template" />
              <input type="hidden" name="key" value={ev.key} />
              <div className="row-actions">
                <select name="templateId" defaultValue={ev.templateId} aria-label="Текст">
                  {templates.map((t) => (
                    <option key={t.id} value={t.id}>
                      {NOTICE_KIND_ICON[t.kind as NoticeKind]} {t.title}
                      {t.promoAmount ? ` · 🎟 ${t.promoAmount}%` : ""}
                    </option>
                  ))}
                </select>
                <SubmitButton variant="secondary" pendingText="Меняю…">
                  Сменить текст
                </SubmitButton>
              </div>
            </ActionForm>
            <NoticeButton kind="event.skip" args={{ key: ev.key }} variant="danger" danger confirm="Не отправлять этот вайп?" confirmMessage="Ни в Discord, ни во ВКонтакте ничего не уйдёт. Промокод, созданный ботом под этот вайп, удалится.">
              Не отправлять
            </NoticeButton>
          </div>
        </Section>
      )}

      {(ev.status === "sent" || ev.status === "partial" || ev.status === "sending") && (
        <Section
          title="Отправка"
          action={ev.status === "partial" ? <NoticeButton kind="event.retry" args={{ key: ev.key }} variant="primary" confirm="Повторить неудавшиеся площадки?" confirmMessage="Удавшиеся не продублируются. Если ВКонтакте не ответил на публикацию, сначала проверь стену: пост мог уйти.">Повторить неудавшиеся</NoticeButton> : null}
        >
          <div className="tiles">
            {(["discord", "vk", "promo"] as const).map((n) => {
              const r = results[n];
              if (!r) return null;
              const detail = r.detail ?? r.text ?? "";
              return (
                <div key={n} className="setting">
                  <div className="setting-body">
                    <div className="setting-title">{n === "vk" ? "ВКонтакте" : n === "promo" ? `Промокод${r.code ? ` ${r.code} · ${r.amount}%` : ""}` : "Discord"}</div>
                    <div className="setting-hint">
                      {n === "vk" && detail.startsWith("https://") ? (
                        <a href={detail} className="link" target="_blank" rel="noreferrer noopener">
                          Пост опубликован
                        </a>
                      ) : (
                        detail || RESULT_TEXT[r.state]
                      )}
                    </div>
                  </div>
                  <span className={RESULT_CHIP[r.state] ?? "chip"}>{RESULT_TEXT[r.state] ?? r.state}</span>
                </div>
              );
            })}
          </div>
        </Section>
      )}

      <Section title="Текст" hint={`Подстановки уже заполнены: дата, время и день недели вайпа. Картинка — ${img ? "из «Настроек»" : "не загружена"}.`}>
        {rendered ? (
          <PostPreview discord={rendered.discord} vk={rendered.vk} imageUrl={img ? `/api/notices/image/${tpl!.kind}?v=${img.updatedAt.getTime()}` : null} />
        ) : (
          <EmptyState icon="message" title="Текст удалён" hint="Выбери другой текст кнопкой «Сменить текст»." />
        )}
      </Section>
    </>
  );
}
