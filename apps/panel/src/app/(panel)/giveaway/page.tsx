import Link from "next/link";
import { formatInZone, formatNumber, getGiveawaySettings, plural, prisma } from "@flamebot/core";
import { AutoRefresh } from "@/components/AutoRefresh";
import { BotPower } from "@/components/BotPower";
import { EmptyState, PageHead, Section } from "@/components/Fields";
import { requirePage } from "@/lib/auth";
import { getBotStates } from "@/lib/botState";
import { memberNames, relative } from "@/lib/giveaways";

export const metadata = { title: "Розыгрыши" };

export default async function GiveawayOverview() {
  const user = await requirePage();
  const monthAgo = new Date(Date.now() - 30 * 86_400_000);
  const [botState, status, settings, active, recent, endedCount, entries30d, delivered, undelivered, problems] = await Promise.all([
    getBotStates(["giveaway"]).then((s) => s.giveaway!),
    prisma.botStatus.findUnique({ where: { botKey: "giveaway" } }),
    getGiveawaySettings(prisma),
    prisma.giveaway.findMany({
      where: { status: "ACTIVE" },
      orderBy: { endsAt: "asc" },
      take: 25,
      include: { _count: { select: { entries: true, promoCodes: true } } },
    }),
    prisma.giveaway.findMany({ where: { status: "ENDED" }, orderBy: { endsAt: "desc" }, take: 5, include: { _count: { select: { entries: true } } } }),
    prisma.giveaway.count({ where: { status: "ENDED" } }),
    prisma.giveawayEntry.count({ where: { joinedAt: { gte: monthAgo } } }),
    prisma.giveawayPromoCode.count({ where: { userId: { not: null }, dmSent: true } }),
    prisma.giveawayPromoCode.count({ where: { userId: { not: null }, dmSent: false } }),
    prisma.botEvent.count({ where: { botKey: "giveaway", level: { in: ["WARN", "ERROR"] }, createdAt: { gte: new Date(Date.now() - 86_400_000) } } }),
  ]);
  const names = await memberNames(recent.flatMap((g) => g.winners));
  const tz = settings.timezone;

  return (
    <>
      <PageHead title="Розыгрыши" hint={`Время итогов — ${settings.timezoneLabel} (${tz}). Создаются розыгрыши командой /розыгрыш в Discord.`}>
        <div className="head-actions">
          <AutoRefresh seconds={10} />
          <BotPower botKey="giveaway" title="Розыгрыши" state={botState} canControl={user.level === "full"} />
        </div>
      </PageHead>

      {botState.enabled && botState.tone === "off" && (
        <p className="notice warn">
          {!status
            ? "Бот розыгрышей ещё не запускался."
            : status.state === "failed" && Date.now() - status.heartbeatAt.getTime() < 3 * 60_000
              ? "Бот не может войти в Discord: проверь GIVEAWAY_DISCORD_TOKEN в .env. Пока он не работает, итоги не подводятся."
              : "Бот розыгрышей не отвечает больше 3 минут: проверь контейнер giveaway-bot. Пока он не работает, итоги не подводятся."}{" "}
          <Link href="/giveaway/events?level=problems" className="link">
            История
          </Link>
        </p>
      )}
      {problems > 0 && (
        <p className="notice warn">
          За сутки {formatNumber(problems)} предупреждений или ошибок.{" "}
          <Link href="/giveaway/events?level=problems" className="link">
            Открыть историю
          </Link>
        </p>
      )}

      <div className="grid grid-4" style={{ marginBottom: 20 }}>
        <div className="metric"><div className="metric-label">Идут сейчас</div><div className="metric-value">{formatNumber(active.length)}</div></div>
        <div className="metric"><div className="metric-label">Проведено всего</div><div className="metric-value">{formatNumber(endedCount)}</div></div>
        <div className="metric"><div className="metric-label">Участий за 30 дней</div><div className="metric-value">{formatNumber(entries30d)}</div></div>
        <div className="metric">
          <div className="metric-label">Промокодов доставлено</div>
          <div className="metric-value">
            {formatNumber(delivered)}
            {undelivered > 0 && <span className="chip warn" style={{ marginLeft: 8, verticalAlign: "middle" }}>{undelivered} не дошло</span>}
          </div>
        </div>
      </div>

      <Section title="Идут сейчас" hint="Итоги бот подводит сам в назначенное время. Досрочно завершить или отменить можно на странице розыгрыша.">
        {active.length === 0 ? (
          <EmptyState icon="gift" title="Активных розыгрышей нет" hint="Создай розыгрыш в Discord: /розыгрыш создать или /розыгрыш быстрый." />
        ) : (
          <div className="card" style={{ padding: "8px 8px 4px" }}>
            <table className="table">
              <thead>
                <tr>
                  <th>Розыгрыш</th>
                  <th>Итоги</th>
                  <th className="num">Участников</th>
                  <th className="num">Победителей</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {active.map((g) => (
                  <tr key={g.id}>
                    <td>
                      <Link href={`/giveaway/${g.id}`} className="member-link">#{g.id} · {g.prize}</Link>{" "}
                      {g.boostersOnly && <span className="chip">🚀 бустеры</span>}{" "}
                      {g._count.promoCodes > 0 && <span className="chip">🎟 промокоды</span>}
                    </td>
                    <td>
                      {formatInZone(g.endsAt, tz)} <span className="muted">· {relative(g.endsAt)}</span>
                    </td>
                    <td className="num">{formatNumber(g._count.entries)}</td>
                    <td className="num">{g.winnersCount}</td>
                    <td style={{ width: 1 }}>
                      <Link href={`/giveaway/${g.id}`} className="btn small">Открыть</Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      {recent.length > 0 && (
        <Section title="Последние итоги" action={<Link href="/giveaway/list?status=ended" className="btn small">Все завершённые</Link>}>
          <div className="card" style={{ padding: "8px 8px 4px" }}>
            <table className="table">
              <tbody>
                {recent.map((g) => (
                  <tr key={g.id}>
                    <td>
                      <Link href={`/giveaway/${g.id}`} className="member-link">#{g.id} · {g.prize}</Link>
                      <div className="muted" style={{ fontSize: 12 }}>
                        {formatInZone(g.endsAt, tz)} · {formatNumber(g._count.entries)} {plural(g._count.entries, "участник", "участника", "участников")}
                      </div>
                    </td>
                    <td>
                      {g.winners.length === 0 ? (
                        <span className="muted">Победителей нет</span>
                      ) : (
                        g.winners.map((id) => <span key={id} className="chip" style={{ marginRight: 4 }}>🥇 {names.get(id) ?? id}</span>)
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Section>
      )}
    </>
  );
}
