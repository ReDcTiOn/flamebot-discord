import Link from "next/link";
import { EVENT_GROUPS, formatNumber, prisma, SNOWFLAKE, type Prisma } from "@flamebot/core";
import { EventTable, eventGroup } from "@/components/EventTable";
import { EmptyState, PageHead } from "@/components/Fields";
import { requirePage } from "@/lib/auth";

export const metadata = { title: "История" };

const PAGE_SIZE = 50;
type LevelKey = "all" | "problems" | "errors";
const LEVELS: Record<LevelKey, { label: string; where: Prisma.BotEventWhereInput }> = {
  all: { label: "Все", where: {} },
  problems: { label: "Предупреждения и ошибки", where: { level: { in: ["WARN", "ERROR"] } } },
  errors: { label: "Только ошибки", where: { level: "ERROR" } },
};

export default async function EventsPage({
  searchParams,
}: {
  searchParams: Promise<{ level?: string; group?: string; q?: string; page?: string }>;
}) {
  await requirePage();
  const params = await searchParams;
  const level: LevelKey = params.level && params.level in LEVELS ? (params.level as LevelKey) : "all";
  const group = params.group && params.group in EVENT_GROUPS ? params.group : null;
  const q = (params.q ?? "").trim().slice(0, 64);
  const page = Math.max(1, Math.min(1000, Number.parseInt(params.page ?? "1", 10) || 1));

  // Поиск по игроку: Discord ID напрямую или по нику через таблицу игроков.
  let memberIds: string[] | null = null;
  if (q) {
    memberIds = SNOWFLAKE.test(q)
      ? [q]
      : (
          await prisma.member.findMany({
            where: { OR: [{ displayName: { contains: q, mode: "insensitive" } }, { username: { contains: q, mode: "insensitive" } }] },
            select: { id: true },
            take: 50,
          })
        ).map((m) => m.id);
  }

  const where: Prisma.BotEventWhereInput = {
    botKey: "rating",
    ...LEVELS[level].where,
    ...(group ? { type: { startsWith: `${group}.` } } : {}),
    ...(memberIds ? { memberId: { in: memberIds } } : {}),
  };

  const since = new Date(Date.now() - 86_400_000);
  const [events, total, problems24h] = await Promise.all([
    prisma.botEvent.findMany({ where, orderBy: { createdAt: "desc" }, take: PAGE_SIZE, skip: (page - 1) * PAGE_SIZE }),
    prisma.botEvent.count({ where }),
    prisma.botEvent.count({ where: { botKey: "rating", level: { in: ["WARN", "ERROR"] }, createdAt: { gte: since } } }),
  ]);
  const ids = [...new Set(events.map((e) => e.memberId).filter((x): x is string => !!x))];
  const members = await prisma.member.findMany({ where: { id: { in: ids } }, select: { id: true, displayName: true } });
  const names = new Map(members.map((m) => [m.id, m.displayName]));

  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const link = (patch: Record<string, string | null>) => {
    const next: Record<string, string> = {};
    const cur = { level: level === "all" ? null : level, group, q: q || null, page: null as string | null, ...patch };
    for (const [k, v] of Object.entries(cur)) if (v) next[k] = v;
    return `/rating/events?${new URLSearchParams(next)}`;
  };

  return (
    <>
      <PageHead
        title="История"
        hint="Всё, что делал бот: покупки, ранги, репутация, заявки, окончание сроков, предупреждения и ошибки. Действия админов в панели — в «Журнале действий»."
      />

      {problems24h > 0 && level === "all" && (
        <p className="notice warn">
          За последние сутки {formatNumber(problems24h)} предупреждений или ошибок.{" "}
          <Link href={link({ level: "problems" })} className="link">
            Показать
          </Link>
        </p>
      )}

      <form method="get" className="toolbar-row">
        <input type="search" name="q" defaultValue={q} placeholder="Игрок: ник или Discord ID" maxLength={64} aria-label="Поиск по игроку" />
        {level !== "all" && <input type="hidden" name="level" value={level} />}
        {group && <input type="hidden" name="group" value={group} />}
        <button type="submit" className="btn">Найти</button>
        {q && (
          <Link href={link({ q: null })} className="btn">
            Сбросить
          </Link>
        )}
        <span className="toolbar-spacer" />
        <nav className="chips" aria-label="Важность">
          {(Object.keys(LEVELS) as LevelKey[]).map((k) => (
            <Link key={k} href={link({ level: k === "all" ? null : k })} className={k === level ? "chip accent" : "chip"}>
              {LEVELS[k].label}
            </Link>
          ))}
        </nav>
      </form>

      <nav className="chips" aria-label="Раздел" style={{ marginBottom: 16 }}>
        <Link href={link({ group: null })} className={!group ? "chip accent" : "chip"}>
          Все разделы
        </Link>
        {Object.entries(EVENT_GROUPS).map(([key, label]) => (
          <Link key={key} href={link({ group: key })} className={group === key ? "chip accent" : "chip"}>
            {label}
          </Link>
        ))}
      </nav>

      {events.length === 0 ? (
        <EmptyState icon="list" title="Событий не найдено" hint={q || group || level !== "all" ? "Попробуй изменить фильтры." : "История начнёт заполняться, когда бот что-нибудь сделает."} />
      ) : (
        <>
          <EventTable
            memberNames={names}
            rows={events.map((e) => ({
              key: `e${e.id}`,
              at: e.createdAt,
              level: e.level,
              group: eventGroup(e.type),
              message: e.message,
              memberId: e.memberId,
              details: e.details,
              source: "bot",
            }))}
          />
          <div className="pager">
            <span>
              Найдено {formatNumber(total)} · страница {page} из {pages}
            </span>
            <span style={{ display: "flex", gap: 8 }}>
              {page > 1 && (
                <Link className="btn small" href={link({ page: String(page - 1) })}>
                  Назад
                </Link>
              )}
              {page < pages && (
                <Link className="btn small" href={link({ page: String(page + 1) })}>
                  Дальше
                </Link>
              )}
            </span>
          </div>
        </>
      )}
    </>
  );
}
