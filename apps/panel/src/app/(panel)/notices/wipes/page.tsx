import Link from "next/link";
import { NOTICE_KIND_ICON, NOTICE_KIND_LABEL, NOTICE_STATUS, formatNumber, prisma, type NoticeKind, type NoticeStatus } from "@flamebot/core";
import { EmptyState, PageHead } from "@/components/Fields";
import { requirePage } from "@/lib/auth";
import { NOTICE_STATUS_CHIP, RESULT_CHIP, noticesView } from "@/lib/notices";

export const metadata = { title: "Вайпы и объявления" };

const PAGE_SIZE = 25;
const RESULT_LABEL: Record<string, string> = { ok: "✓", dry: "проба", error: "ошибка" };

export default async function NoticeWipesPage({ searchParams }: { searchParams: Promise<{ page?: string; tests?: string }> }) {
  await requirePage();
  const { fmt } = await noticesView();
  const params = await searchParams;
  const tests = params.tests === "1";
  const page = Math.max(1, Math.min(1000, Number.parseInt(params.page ?? "1", 10) || 1));
  const where = tests ? {} : { isTest: false };
  const [rows, total, templates] = await Promise.all([
    prisma.noticeEvent.findMany({ where, orderBy: { wipeAt: "desc" }, take: PAGE_SIZE, skip: (page - 1) * PAGE_SIZE }),
    prisma.noticeEvent.count({ where }),
    prisma.noticeTemplate.findMany({ select: { id: true, title: true } }),
  ]);
  const titles = new Map(templates.map((t) => [t.id, t.title]));
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const q = (p: number) => `/notices/wipes?page=${p}${tests ? "&tests=1" : ""}`;

  return (
    <>
      <PageHead title="Вайпы" hint="Все вайпы, о которых бот спрашивал подтверждение: какой текст ушёл, куда и с каким промокодом.">
        <Link href={tests ? "/notices/wipes" : "/notices/wipes?tests=1"} className="btn small">
          {tests ? "Скрыть тесты" : "Показать тесты"}
        </Link>
      </PageHead>
      {rows.length === 0 ? (
        <EmptyState icon="megaphone" title="Вайпов пока не было" hint="Бот заводит вайп, когда присылает текст на подтверждение." />
      ) : (
        <div className="card" style={{ padding: "8px 8px 12px" }}>
          <table className="table">
            <thead>
              <tr>
                <th>Вайп</th>
                <th>Текст</th>
                <th>Статус</th>
                <th>Discord</th>
                <th>ВКонтакте</th>
                <th>Промокод</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((ev) => {
                const r = (ev.results ?? {}) as Record<string, { state?: string } | undefined>;
                const promo = ev.promo as { code: string; amount: number } | null;
                return (
                  <tr key={ev.key}>
                    <td>
                      <Link href={`/notices/wipes/${encodeURIComponent(ev.key)}`} className="member-link">
                        {fmt(ev.wipeAt)}
                      </Link>{" "}
                      <span className="muted">
                        {NOTICE_KIND_ICON[ev.kind as NoticeKind]} {NOTICE_KIND_LABEL[ev.kind as NoticeKind]}
                      </span>
                      {ev.isTest && <span className="chip"> 🧪 тест</span>}
                    </td>
                    <td className="secondary">{titles.get(ev.templateId) ?? ev.templateId}</td>
                    <td>
                      <span className={NOTICE_STATUS_CHIP[ev.status] ?? "chip"}>{NOTICE_STATUS[ev.status as NoticeStatus] ?? ev.status}</span>
                    </td>
                    {(["discord", "vk"] as const).map((n) => (
                      <td key={n}>{r[n]?.state ? <span className={RESULT_CHIP[r[n]!.state!] ?? "chip"}>{RESULT_LABEL[r[n]!.state!] ?? r[n]!.state}</span> : <span className="muted">—</span>}</td>
                    ))}
                    <td className="secondary">{promo ? `${promo.code} · ${promo.amount}%` : "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <div className="pager" style={{ padding: "0 10px" }}>
            <span>
              Всего {formatNumber(total)} · страница {page} из {pages}
            </span>
            <span style={{ display: "flex", gap: 8 }}>
              {page > 1 && <Link className="btn small" href={q(page - 1)}>Назад</Link>}
              {page < pages && <Link className="btn small" href={q(page + 1)}>Дальше</Link>}
            </span>
          </div>
        </div>
      )}
    </>
  );
}
