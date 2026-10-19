import Link from "next/link";
import { formatNumber, prisma, SNOWFLAKE } from "@flamebot/core";
import { ActionForm, SubmitButton } from "@/components/ActionForm";
import { requirePage } from "@/lib/auth";
import { avatarUrl } from "@/lib/discord";
import { adjustMember, resetMember } from "../actions";
import { PageHead } from "@/components/Fields";

export const metadata = { title: "Пользователи" };

const PAGE_SIZE = 25;

export default async function MembersPage({ searchParams }: { searchParams: Promise<{ q?: string; page?: string }> }) {
  await requirePage();
  const params = await searchParams;
  const q = (params.q ?? "").trim().slice(0, 64);
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

  const [rows, total] = await Promise.all([
    prisma.member.findMany({
      where,
      orderBy: [{ xp: "desc" }, { createdAt: "asc" }],
      take: PAGE_SIZE,
      skip: (page - 1) * PAGE_SIZE,
      include: { rank: true },
    }),
    prisma.member.count({ where }),
  ]);
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const link = (p: number) => `/rating/members?${new URLSearchParams({ ...(q ? { q } : {}), page: String(p) })}`;

  return (
    <>
      <PageHead title="Пользователи" hint="Поиск игрока, ручная правка опыта, скрапа и репутации. Каждое изменение пишется в журнал с причиной." />

      <form method="get" style={{ display: "flex", gap: 8, marginBottom: 16 }}>
        <input type="search" name="q" defaultValue={q} placeholder="Ник или Discord ID" className="wide" maxLength={64} />
        <button type="submit" className="btn">Найти</button>
      </form>

      <div className="card">
        {rows.length === 0 ? (
          <p className="empty">{q ? "Никого не нашли." : "В рейтинге пока никого нет."}</p>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Игрок</th>
                <th>Ранг</th>
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
                      <img className="avatar" src={avatarUrl(m.id, m.avatarHash)} alt="" width={28} height={28} />
                      <div>
                        <div>{m.displayName} {!m.inGuild && <span className="chip">Вышел</span>}</div>
                        <div className="muted" style={{ fontSize: 12 }}>@{m.username} · {m.id}</div>
                      </div>
                    </div>
                  </td>
                  <td>{m.rank ? `${m.rank.emoji ?? ""} ${m.rank.name}` : <span className="muted">—</span>}</td>
                  <td className="num">{formatNumber(m.xp)}</td>
                  <td className="num">{formatNumber(m.scrap)}</td>
                  <td className="num">{formatNumber(m.rep)}</td>
                  <td style={{ width: 1 }}>
                    <details className="edit" style={{ position: "relative" }}>
                      <summary className="btn small">Изменить</summary>
                      <div className="popover">
                        <ActionForm action={adjustMember} resetOnSuccess>
                          <input type="hidden" name="memberId" value={m.id} />
                          <div className="grid grid-2">
                            <label className="stack"><span>Что меняем</span>
                              <select name="field" defaultValue="scrap" className="wide">
                                <option value="scrap">Скрап</option>
                                <option value="xp">Опыт</option>
                                <option value="rep">Репутация</option>
                              </select>
                            </label>
                            <label className="stack"><span>На сколько (±)</span>
                              <input type="number" name="delta" placeholder="-100 или 250" required className="wide" />
                            </label>
                          </div>
                          <label className="stack" style={{ marginTop: 8 }}><span>Причина</span>
                            <input type="text" name="reason" required minLength={3} maxLength={200} className="wide" placeholder="Победа в ивенте" />
                          </label>
                          <div className="form-actions">
                            <SubmitButton>Применить</SubmitButton>
                          </div>
                        </ActionForm>
                        <div style={{ borderTop: "1px solid var(--border)", marginTop: 12, paddingTop: 12 }}>
                          <ActionForm action={resetMember} confirm={`Обнулить опыт, скрап, репутацию и бейджи игрока ${m.displayName}?`}>
                            <input type="hidden" name="memberId" value={m.id} />
                            <label className="stack"><span>Обнулить всё (причина обязательна)</span>
                              <input type="text" name="reason" required minLength={3} maxLength={200} className="wide" placeholder="Накрутка опыта" />
                            </label>
                            <div className="form-actions">
                              <SubmitButton variant="danger">Обнулить</SubmitButton>
                            </div>
                          </ActionForm>
                        </div>
                      </div>
                    </details>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <div className="pager">
          <span>Найдено {formatNumber(total)} · страница {page} из {pages}</span>
          <span style={{ display: "flex", gap: 8 }}>
            {page > 1 && <Link className="btn small" href={link(page - 1)}>Назад</Link>}
            {page < pages && <Link className="btn small" href={link(page + 1)}>Дальше</Link>}
          </span>
        </div>
      </div>
    </>
  );
}
