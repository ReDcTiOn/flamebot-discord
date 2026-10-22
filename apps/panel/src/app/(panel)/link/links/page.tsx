import Link from "next/link";
import { SNOWFLAKE, STEAM_ID, formatNumber, prisma, steamProfileUrl, type Prisma } from "@flamebot/core";
import { ActionForm, SubmitButton } from "@/components/ActionForm";
import { EmptyState, PageHead } from "@/components/Fields";
import { requirePage } from "@/lib/auth";
import { when } from "@/lib/link";
import { unlinkSteam } from "../actions";

export const metadata = { title: "Все привязки" };

const PAGE_SIZE = 25;
const FILTERS = {
  all: "Все",
  left: "Вышли из Discord",
} as const;
type FilterKey = keyof typeof FILTERS;

export default async function LinksPage({ searchParams }: { searchParams: Promise<{ q?: string; page?: string; filter?: string }> }) {
  await requirePage();
  const params = await searchParams;
  const q = (params.q ?? "").trim().slice(0, 64);
  const filter: FilterKey = params.filter && params.filter in FILTERS ? (params.filter as FilterKey) : "all";
  const page = Math.max(1, Math.min(1000, Number.parseInt(params.page ?? "1", 10) || 1));

  // Поиск: SteamID и Discord ID — точно, ники — по вхождению.
  const search: Prisma.SteamLinkWhereInput = !q
    ? {}
    : STEAM_ID.test(q)
      ? { steamId: q }
      : SNOWFLAKE.test(q)
        ? { discordId: q }
        : {
            OR: [
              { discordName: { contains: q, mode: "insensitive" } },
              { steamName: { contains: q, mode: "insensitive" } },
            ],
          };
  const where: Prisma.SteamLinkWhereInput = { ...search, ...(filter === "left" ? { inGuild: false } : {}) };

  const [rows, total] = await Promise.all([
    prisma.steamLink.findMany({ where, orderBy: { linkedAt: "desc" }, take: PAGE_SIZE, skip: (page - 1) * PAGE_SIZE, include: { server: true } }),
    prisma.steamLink.count({ where }),
  ]);
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const link = (p: number, f: FilterKey = filter) =>
    `/link/links?${new URLSearchParams({ ...(q ? { q } : {}), ...(f !== "all" ? { filter: f } : {}), ...(p > 1 ? { page: String(p) } : {}) })}`;

  return (
    <>
      <PageHead title="Все привязки" hint="Один Discord — один Steam на все серверы. После отвязки бот снимет роль, а игрок сможет привязаться заново, в том числе к другому аккаунту." />

      <form method="get" className="toolbar-row">
        <input type="search" name="q" defaultValue={q} placeholder="Ник, Discord ID или SteamID" maxLength={64} aria-label="Поиск привязки" />
        {filter !== "all" && <input type="hidden" name="filter" value={filter} />}
        <button type="submit" className="btn">Найти</button>
        <span className="toolbar-spacer" />
        <nav className="chips" aria-label="Фильтр">
          {(Object.keys(FILTERS) as FilterKey[]).map((k) => (
            <Link key={k} href={link(1, k)} className={k === filter ? "chip accent" : "chip"}>
              {FILTERS[k]}
            </Link>
          ))}
        </nav>
      </form>

      {rows.length === 0 ? (
        <EmptyState
          icon="link"
          title={q || filter !== "all" ? "Никого не нашли" : "Привязок пока нет"}
          hint={q ? "Проверь ник или вставь Discord ID / SteamID целиком." : "Они появятся, когда игроки напишут /connect в игре и введут код в Discord."}
        />
      ) : (
        <div className="card" style={{ padding: "8px 8px 12px" }}>
          <table className="table">
            <thead>
              <tr>
                <th>Discord</th>
                <th>Steam</th>
                <th>Сервер</th>
                <th>Привязан</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.discordId}>
                  <td>
                    <div>
                      @{r.discordName} {!r.inGuild && <span className="chip warn">Вышел</span>}
                    </div>
                    <div className="muted" style={{ fontSize: 12 }}>{r.discordId}</div>
                  </td>
                  <td>
                    <div>
                      <a href={steamProfileUrl(r.steamId)} target="_blank" rel="noopener noreferrer" className="member-link">
                        {r.steamName}
                      </a>
                    </div>
                    <div className="muted" style={{ fontSize: 12 }}>{r.steamId}</div>
                  </td>
                  <td>{r.server?.name ?? <span className="muted">—</span>}</td>
                  <td>{when(r.linkedAt)}</td>
                  <td style={{ width: 1 }}>
                    <ActionForm
                      action={unlinkSteam}
                      confirm={`Отвязать @${r.discordName} от ${r.steamName}?`}
                      confirmMessage="Бот снимет роль за привязку. Игрок сможет привязаться заново командой /connect."
                      confirmLabel="Отвязать"
                      danger
                    >
                      <input type="hidden" name="discordId" value={r.discordId} />
                      <SubmitButton variant="danger" pendingText="Отвязываю…">Отвязать</SubmitButton>
                    </ActionForm>
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
