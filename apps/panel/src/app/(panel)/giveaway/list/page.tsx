import Link from "next/link";
import { formatInZone, formatNumber, getGiveawaySettings, prisma, type GiveawayStatus, type Prisma } from "@flamebot/core";
import { EmptyState, PageHead } from "@/components/Fields";
import { requirePage } from "@/lib/auth";
import { GIVEAWAY_STATUS } from "@/lib/giveaways";

export const metadata = { title: "Все розыгрыши" };

const PAGE_SIZE = 25;
const FILTERS = {
  all: { label: "Все", status: null },
  active: { label: "Идут", status: "ACTIVE" },
  ended: { label: "Завершённые", status: "ENDED" },
  cancelled: { label: "Отменённые", status: "CANCELLED" },
} as const satisfies Record<string, { label: string; status: GiveawayStatus | null }>;
type FilterKey = keyof typeof FILTERS;

export default async function GiveawayListPage({ searchParams }: { searchParams: Promise<{ q?: string; status?: string; page?: string }> }) {
  await requirePage();
  const params = await searchParams;
  const q = (params.q ?? "").trim().slice(0, 64);
  const filter: FilterKey = params.status && params.status in FILTERS ? (params.status as FilterKey) : "all";
  const page = Math.max(1, Math.min(1000, Number.parseInt(params.page ?? "1", 10) || 1));

  const status = FILTERS[filter].status;
  const byId = /^#?\d{1,9}$/.test(q) ? Number(q.replace("#", "")) : null;
  const where: Prisma.GiveawayWhereInput = {
    ...(status ? { status } : {}),
    ...(q ? { OR: [{ prize: { contains: q, mode: "insensitive" } }, ...(byId ? [{ id: byId }] : [])] } : {}),
  };

  const [settings, rows, total] = await Promise.all([
    getGiveawaySettings(prisma),
    prisma.giveaway.findMany({
      where,
      orderBy: [{ endsAt: "desc" }, { id: "desc" }],
      take: PAGE_SIZE,
      skip: (page - 1) * PAGE_SIZE,
      include: { _count: { select: { entries: true, promoCodes: true } } },
    }),
    prisma.giveaway.count({ where }),
  ]);
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const link = (p: number, f: FilterKey = filter) =>
    `/giveaway/list?${new URLSearchParams({ ...(q ? { q } : {}), ...(f !== "all" ? { status: f } : {}), ...(p > 1 ? { page: String(p) } : {}) })}`;

  return (
    <>
      <PageHead title="Все розыгрыши" hint={`Время итогов — ${settings.timezoneLabel}. Нажми на розыгрыш, чтобы увидеть участников, победителей и промокоды.`} />

      <form method="get" className="toolbar-row">
        <input type="search" name="q" defaultValue={q} placeholder="Приз или номер розыгрыша" maxLength={64} aria-label="Поиск розыгрыша" />
        {filter !== "all" && <input type="hidden" name="status" value={filter} />}
        <button type="submit" className="btn">Найти</button>
        <span className="toolbar-spacer" />
        <nav className="chips" aria-label="Статус">
          {(Object.keys(FILTERS) as FilterKey[]).map((k) => (
            <Link key={k} href={link(1, k)} className={k === filter ? "chip accent" : "chip"}>
              {FILTERS[k].label}
            </Link>
          ))}
        </nav>
      </form>

      {rows.length === 0 ? (
        <EmptyState
          icon="gift"
          title={q || filter !== "all" ? "Ничего не нашли" : "Розыгрышей пока не было"}
          hint={q || filter !== "all" ? "Попробуй изменить поиск или фильтр." : "Создай первый в Discord: /розыгрыш создать."}
        />
      ) : (
        <div className="card" style={{ padding: "8px 8px 12px" }}>
          <table className="table">
            <thead>
              <tr>
                <th>Розыгрыш</th>
                <th>Статус</th>
                <th>Итоги</th>
                <th className="num">Участников</th>
                <th className="num">Победителей</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map((g) => (
                <tr key={g.id}>
                  <td>
                    <Link href={`/giveaway/${g.id}`} className="member-link">#{g.id} · {g.prize}</Link>{" "}
                    {g.boostersOnly && <span className="chip">🚀</span>} {g._count.promoCodes > 0 && <span className="chip">🎟</span>}
                  </td>
                  <td><span className={GIVEAWAY_STATUS[g.status].chip}>{GIVEAWAY_STATUS[g.status].label}</span></td>
                  <td className="secondary" style={{ whiteSpace: "nowrap" }}>{formatInZone(g.endsAt, settings.timezone)}</td>
                  <td className="num">{formatNumber(g._count.entries)}</td>
                  <td className="num">{g.status === "ENDED" ? `${g.winners.length} / ${g.winnersCount}` : g.winnersCount}</td>
                  <td style={{ width: 1 }}>
                    <Link href={`/giveaway/${g.id}`} className="btn small">Открыть</Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="pager" style={{ padding: "0 10px" }}>
            <span>
              Найдено {formatNumber(total)} · страница {page} из {pages} · 🚀 только бустеры · 🎟 с промокодами
            </span>
            <span style={{ display: "flex", gap: 8 }}>
              {page > 1 && <Link className="btn small" href={link(page - 1)}>Назад</Link>}
              {page < pages && <Link className="btn small" href={link(page + 1)}>Дальше</Link>}
            </span>
          </div>
        </div>
      )}
    </>
  );
}
