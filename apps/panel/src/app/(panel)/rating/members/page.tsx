import Link from "next/link";
import { formatNumber, levelFromExp, prisma, SNOWFLAKE } from "@flamebot/core";
import { EmptyState, PageHead } from "@/components/Fields";
import { requirePage } from "@/lib/auth";
import { avatarUrl } from "@/lib/discord";

export const metadata = { title: "Игроки" };

const PAGE_SIZE = 25;
const SORTS = {
  xp: { label: "По опыту", field: "xp" },
  scrap: { label: "По скрапу", field: "scrap" },
  rep: { label: "По репутации", field: "rep" },
  recent: { label: "Недавно активные", field: "lastXpAt" },
} as const;
type SortKey = keyof typeof SORTS;

export default async function MembersPage({ searchParams }: { searchParams: Promise<{ q?: string; page?: string; sort?: string }> }) {
  await requirePage();
  const params = await searchParams;
  const q = (params.q ?? "").trim().slice(0, 64);
  const sort: SortKey = params.sort && params.sort in SORTS ? (params.sort as SortKey) : "xp";
  const page = Math.max(1, Math.min(1000, Number.parseInt(params.page ?? "1", 10) || 1));

  const where = q
    ? SNOWFLAKE.test(q)
      ? { id: q }
      : {
          OR: [
            { displayName: { contains: q, mode: "insensitive" as const } },
            { username: { contains: q, mode: "insensitive" as const } },
          ],
        }
    : {};

  const field = SORTS[sort].field;
  const [rows, total] = await Promise.all([
    prisma.member.findMany({
      where,
      orderBy: [{ [field]: field === "lastXpAt" ? { sort: "desc", nulls: "last" } : "desc" }, { createdAt: "asc" }],
      take: PAGE_SIZE,
      skip: (page - 1) * PAGE_SIZE,
      include: { rank: true },
    }),
    prisma.member.count({ where }),
  ]);
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const link = (p: number, s: SortKey = sort) =>
    `/rating/members?${new URLSearchParams({ ...(q ? { q } : {}), ...(s !== "xp" ? { sort: s } : {}), ...(p > 1 ? { page: String(p) } : {}) })}`;

  return (
    <>
      <PageHead title="Игроки" hint="Нажми на игрока, чтобы открыть его карточку: покупки, бейджи, репутация, история и ручная правка баланса." />

      <form method="get" className="toolbar-row">
        <input type="search" name="q" defaultValue={q} placeholder="Ник или Discord ID" maxLength={64} aria-label="Поиск игрока" />
        {sort !== "xp" && <input type="hidden" name="sort" value={sort} />}
        <button type="submit" className="btn">Найти</button>
        <span className="toolbar-spacer" />
        <nav className="chips" aria-label="Сортировка">
          {(Object.keys(SORTS) as SortKey[]).map((k) => (
            <Link key={k} href={link(1, k)} className={k === sort ? "chip accent" : "chip"}>
              {SORTS[k].label}
            </Link>
          ))}
        </nav>
      </form>

      {rows.length === 0 ? (
        <EmptyState icon="users" title={q ? "Никого не нашли" : "В рейтинге пока никого нет"} hint={q ? "Проверь ник или вставь Discord ID." : "Игроки появятся, когда начнут писать в чат."} />
      ) : (
        <div className="card" style={{ padding: "8px 8px 12px" }}>
          <table className="table">
            <thead>
              <tr>
                <th>Игрок</th>
                <th>Ранг</th>
                <th className="num">Уровень</th>
                <th className="num">Опыт</th>
                <th className="num">Скрап</th>
                <th className="num">Репутация</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map((m) => (
                <tr key={m.id}>
                  <td>
                    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img className="avatar" src={avatarUrl(m.id, m.avatarHash)} alt="" width={30} height={30} />
                      <div style={{ minWidth: 0 }}>
                        <div>
                          <Link href={`/rating/members/${m.id}`} className="member-link">
                            {m.displayName}
                          </Link>{" "}
                          {!m.inGuild && <span className="chip">Вышел</span>}
                        </div>
                        <div className="muted" style={{ fontSize: 12 }}>@{m.username}</div>
                      </div>
                    </div>
                  </td>
                  <td>{m.rank ? <span className="chip">{m.rank.emoji} {m.rank.name}</span> : <span className="muted">—</span>}</td>
                  <td className="num">{levelFromExp(m.xp)}</td>
                  <td className="num">{formatNumber(m.xp)}</td>
                  <td className="num">{formatNumber(m.scrap)}</td>
                  <td className="num">{formatNumber(m.rep)}</td>
                  <td style={{ width: 1 }}>
                    <Link href={`/rating/members/${m.id}`} className="btn small">
                      Открыть
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="pager" style={{ padding: "0 10px" }}>
            <span>
              Найдено {formatNumber(total)} · страница {page} из {pages}
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
