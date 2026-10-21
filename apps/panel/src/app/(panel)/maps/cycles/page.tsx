import Link from "next/link";
import { MAPS_CYCLE_STATUS, MAPS_PANEL_STATE, formatNumber, prisma } from "@flamebot/core";
import { EmptyState, PageHead } from "@/components/Fields";
import { requirePage } from "@/lib/auth";
import { CYCLE_CHIP, mapsView } from "@/lib/maps";

export const metadata = { title: "Вайпы и карты" };

const PAGE_SIZE = 25;

export default async function MapsCyclesPage({ searchParams }: { searchParams: Promise<{ page?: string }> }) {
  await requirePage();
  const { fmt } = await mapsView();
  const page = Math.max(1, Math.min(1000, Number.parseInt((await searchParams).page ?? "1", 10) || 1));
  const [rows, total] = await Promise.all([
    prisma.mapsCycle.findMany({
      orderBy: { wipeAt: "desc" },
      take: PAGE_SIZE,
      skip: (page - 1) * PAGE_SIZE,
      include: { slots: { select: { status: true, source: true } } },
    }),
    prisma.mapsCycle.count(),
  ]);
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <>
      <PageHead title="Вайпы и карты" hint="Все вайпы, к которым бот готовил карты. Нажми на вайп, чтобы увидеть карты серверов, анонс и ссылки в Pterodactyl." />
      {rows.length === 0 ? (
        <EmptyState icon="map" title="Вайпов пока не было" hint="Генерация начнётся по расписанию или с обзора — кнопкой «Сгенерировать сейчас»." />
      ) : (
        <div className="card" style={{ padding: "8px 8px 12px" }}>
          <table className="table">
            <thead>
              <tr>
                <th>Вайп</th>
                <th>Статус</th>
                <th className="num">Карт подтверждено</th>
                <th>Pterodactyl</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map((c) => {
                const up = c.slots.filter((x) => x.status === "uploaded").length;
                const manual = c.slots.filter((x) => x.source === "manual").length;
                return (
                  <tr key={c.id}>
                    <td>
                      <Link href={`/maps/cycles/${encodeURIComponent(c.id)}`} className="member-link">
                        {fmt(c.wipeAt)}
                      </Link>{" "}
                      {c.staging && <span className="chip">🧪</span>} {c.blueprints && <span className="chip warn">🧹 глобальный</span>}
                      <div className="muted" style={{ fontSize: 12 }}>{c.id}</div>
                    </td>
                    <td>
                      <span className={CYCLE_CHIP[c.status] ?? "chip"}>{MAPS_CYCLE_STATUS[c.status] ?? c.status}</span>
                    </td>
                    <td className="num">
                      {formatNumber(up)} / {formatNumber(c.slots.length)}
                      {manual ? <span className="muted"> · своих {manual}</span> : null}
                    </td>
                    <td className="secondary">{MAPS_PANEL_STATE[c.panelState] ?? c.panelState}</td>
                    <td style={{ width: 1 }}>
                      <Link href={`/maps/cycles/${encodeURIComponent(c.id)}`} className="btn small">Открыть</Link>
                    </td>
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
              {page > 1 && <Link className="btn small" href={`/maps/cycles?page=${page - 1}`}>Назад</Link>}
              {page < pages && <Link className="btn small" href={`/maps/cycles?page=${page + 1}`}>Дальше</Link>}
            </span>
          </div>
        </div>
      )}
    </>
  );
}
