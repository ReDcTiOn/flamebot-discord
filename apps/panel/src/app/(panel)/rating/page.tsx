import Link from "next/link";
import { formatNumber, prisma, startOfUtcDay } from "@flamebot/core";
import { requirePage } from "@/lib/auth";
import { PageHead } from "@/components/Fields";

export const metadata = { title: "Scrap Rank" };

const DAYS = 14;

export default async function RatingOverview() {
  await requirePage();
  const today = startOfUtcDay();
  const from = new Date(today.getTime() - (DAYS - 1) * 86_400_000);

  const [members, activeToday, scrap, stats, purchases, ranks, problems, pendingRequests] = await Promise.all([
    prisma.member.count({ where: { inGuild: true } }),
    prisma.member.count({ where: { lastXpAt: { gte: today } } }),
    prisma.member.aggregate({ _sum: { scrap: true } }),
    prisma.dailyStat.findMany({ where: { date: { gte: from } }, orderBy: { date: "asc" } }),
    prisma.purchase.findMany({ orderBy: { createdAt: "desc" }, take: 8, include: { item: true, member: true } }),
    prisma.rank.findMany({ orderBy: { minXp: "asc" }, include: { _count: { select: { members: true } } } }),
    prisma.botEvent.count({ where: { botKey: "rating", level: { in: ["WARN", "ERROR"] }, createdAt: { gte: new Date(Date.now() - 86_400_000) } } }),
    prisma.customRoleRequest.count({ where: { status: "PENDING" } }),
  ]);

  const byDay = new Map(stats.map((s) => [s.date.toISOString().slice(0, 10), s]));
  const days = Array.from({ length: DAYS }, (_, i) => {
    const d = new Date(from.getTime() + i * 86_400_000);
    const s = byDay.get(d.toISOString().slice(0, 10));
    return { date: d, messages: s?.messages ?? 0 };
  });
  const maxMessages = Math.max(1, ...days.map((d) => d.messages));
  const todayStat = byDay.get(today.toISOString().slice(0, 10));
  const maxRank = Math.max(1, ...ranks.map((r) => r._count.members));

  return (
    <>
      <PageHead title="Scrap Rank" hint="Сводка по активности и экономике сервера." />

      {problems > 0 && (
        <p className="notice warn">
          За последние сутки {formatNumber(problems)} предупреждений или ошибок бота.{" "}
          <Link href="/rating/events?level=problems" className="link">
            Открыть историю
          </Link>
        </p>
      )}
      {pendingRequests > 0 && (
        <p className="notice">
          Заявок на личные роли ждёт решения: {formatNumber(pendingRequests)}.{" "}
          <Link href="/rating/shop?tab=requests" className="link">
            Посмотреть
          </Link>
        </p>
      )}

      <div className="grid grid-4" style={{ marginBottom: 16 }}>
        <div className="metric"><div className="metric-label">Участников в рейтинге</div><div className="metric-value">{formatNumber(members)}</div></div>
        <div className="metric"><div className="metric-label">Активны сегодня</div><div className="metric-value">{formatNumber(activeToday)}</div></div>
        <div className="metric"><div className="metric-label">Опыта за сегодня</div><div className="metric-value">{formatNumber(todayStat?.xpAwarded ?? 0)}</div></div>
        <div className="metric"><div className="metric-label">Скрапа на руках</div><div className="metric-value">{formatNumber(scrap._sum.scrap ?? 0)}</div></div>
      </div>

      <div className="grid grid-2">
        <div className="card">
          <div className="card-head">
            <div>
              <h2>Сообщения с опытом</h2>
              <p>За последние {DAYS} дней (UTC)</p>
            </div>
          </div>
          <div className="bars" role="img" aria-label="Сообщения с опытом по дням">
            {days.map((d) => (
              <div
                key={d.date.toISOString()}
                className="bar"
                style={{ height: `${Math.round((d.messages / maxMessages) * 100)}%` }}
                title={`${d.date.toLocaleDateString("ru-RU")}: ${formatNumber(d.messages)}`}
              />
            ))}
          </div>
          <div className="bars-labels">
            {days.map((d, i) => (
              <span key={d.date.toISOString()}>{i % 2 === DAYS % 2 ? "" : d.date.getUTCDate()}</span>
            ))}
          </div>
        </div>

        <div className="card">
          <div className="card-head">
            <div>
              <h2>Игроки по рангам</h2>
              <p>Сколько людей сейчас на каждом ранге</p>
            </div>
          </div>
          {ranks.map((r) => (
            <div key={r.id} style={{ display: "grid", gridTemplateColumns: "120px 1fr 48px", alignItems: "center", gap: 10, marginBottom: 8 }}>
              <span>{r.emoji} {r.name}</span>
              <div style={{ background: "var(--surface-3)", borderRadius: 4, height: 8, overflow: "hidden" }}>
                <div style={{ width: `${(r._count.members / maxRank) * 100}%`, height: "100%", background: "var(--accent)" }} />
              </div>
              <span className="secondary" style={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{formatNumber(r._count.members)}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="card">
        <div className="card-head"><h2>Последние покупки</h2></div>
        {purchases.length === 0 ? (
          <p className="empty">Покупок пока нет.</p>
        ) : (
          <table className="table">
            <thead><tr><th>Игрок</th><th>Товар</th><th className="num">Цена</th><th>Когда</th></tr></thead>
            <tbody>
              {purchases.map((p) => (
                <tr key={p.id}>
                  <td>{p.member.displayName}</td>
                  <td>{p.item.name}{p.customName && <span className="muted"> · {p.customName}</span>}</td>
                  <td className="num">{formatNumber(p.price)}</td>
                  <td className="secondary">{p.createdAt.toLocaleString("ru-RU")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}
