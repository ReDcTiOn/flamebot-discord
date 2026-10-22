import Link from "next/link";
import { formatNumber, getLinkSettings, prisma, steamProfileUrl } from "@flamebot/core";
import { AutoRefresh } from "@/components/AutoRefresh";
import { BotPower } from "@/components/BotPower";
import { EmptyState, PageHead, Section } from "@/components/Fields";
import { requirePage } from "@/lib/auth";
import { getBotStates } from "@/lib/botState";
import { when } from "@/lib/link";

export const metadata = { title: "Привязка Steam" };

export default async function LinkOverview() {
  const user = await requirePage();
  const full = user.level === "full";
  const now = new Date();
  const weekAgo = new Date(now.getTime() - 7 * 86_400_000);
  const [botState, status, settings, total, week, left, pending, servers, recent, problems] = await Promise.all([
    getBotStates(["link"]).then((s) => s.link!),
    prisma.botStatus.findUnique({ where: { botKey: "link" } }),
    getLinkSettings(prisma),
    prisma.steamLink.count(),
    prisma.steamLink.count({ where: { linkedAt: { gte: weekAgo } } }),
    prisma.steamLink.count({ where: { inGuild: false } }),
    prisma.linkCode.count({ where: { expiresAt: { gt: now } } }),
    prisma.linkServer.findMany({ select: { enabled: true } }),
    prisma.steamLink.findMany({ orderBy: { linkedAt: "desc" }, take: 8, include: { server: true } }),
    prisma.botEvent.count({ where: { botKey: "link", level: { in: ["WARN", "ERROR"] }, createdAt: { gte: new Date(now.getTime() - 86_400_000) } } }),
  ]);
  const channel = settings.channelId ? await prisma.guildChannel.findUnique({ where: { id: settings.channelId } }) : null;
  const role = settings.roleId ? await prisma.guildRole.findUnique({ where: { id: settings.roleId } }) : null;
  const activeServers = servers.filter((s) => s.enabled).length;

  // Что ещё не настроено: без этого игроки не смогут привязаться.
  const todo: { text: string; href: string | null }[] = [];
  if (!status) todo.push({ text: "Бот ещё не запускался: задай токен в «Подключении» и запусти контейнер link-bot.", href: full ? "/link/connection" : null });
  if (!settings.channelId) todo.push({ text: "Не выбран канал с кнопкой «Привязать».", href: "/link/settings" });
  if (!settings.roleId) todo.push({ text: "Не выбрана роль за привязку: аккаунты свяжутся, но роль никто не получит.", href: "/link/settings" });
  if (activeServers === 0) todo.push({ text: "Не подключён ни один игровой сервер: /connect в игре не заработает.", href: full ? "/link/servers" : null });

  return (
    <>
      <PageHead title="Привязка Steam" hint="Игрок пишет /connect на любом сервере RUST, нажимает «Привязать» в Discord и вводит код. Связка общая для всех серверов.">
        <div className="head-actions">
          <AutoRefresh seconds={10} />
          <BotPower botKey="link" title="Привязка Steam" state={botState} canControl={full} />
        </div>
      </PageHead>

      {botState.enabled && botState.tone === "off" && status && (
        <p className="notice warn">
          {status.state === "failed" && Date.now() - status.heartbeatAt.getTime() < 3 * 60_000
            ? `Бот не может войти в Discord: ${status.loginError ?? "проверь токен в разделе «Подключение»"}. Пока он не работает, игроки не получают коды.`
            : "Бот привязки не отвечает больше 3 минут: проверь контейнер link-bot. Пока он не работает, игроки не получают коды."}{" "}
          <Link href="/link/events?level=problems" className="link">
            История
          </Link>
        </p>
      )}
      {todo.map((t) => (
        <p key={t.text} className="notice warn">
          {t.text}{" "}
          {t.href && (
            <Link href={t.href} className="link">
              Настроить
            </Link>
          )}
        </p>
      ))}
      {problems > 0 && (
        <p className="notice warn">
          За сутки {formatNumber(problems)} предупреждений или ошибок.{" "}
          <Link href="/link/events?level=problems" className="link">
            Открыть историю
          </Link>
        </p>
      )}

      <div className="grid grid-4" style={{ marginBottom: 20 }}>
        <div className="metric"><div className="metric-label">Привязано всего</div><div className="metric-value">{formatNumber(total)}</div></div>
        <div className="metric"><div className="metric-label">За 7 дней</div><div className="metric-value">{formatNumber(week)}</div></div>
        <div className="metric"><div className="metric-label">Ждут ввода кода</div><div className="metric-value">{formatNumber(pending)}</div></div>
        <div className="metric">
          <div className="metric-label">Вышли из Discord</div>
          <div className="metric-value">{formatNumber(left)}</div>
        </div>
      </div>

      <Section title="Настройки" action={<Link href="/link/settings" className="btn small">Изменить</Link>}>
        <div className="tiles group">
          <div className="setting">
            <div className="setting-body">
              <div className="setting-title">Канал с кнопкой</div>
              <div className="setting-hint">{channel ? `# ${channel.name}` : "не выбран"}</div>
            </div>
          </div>
          <div className="setting">
            <div className="setting-body">
              <div className="setting-title">Роль за привязку</div>
              <div className="setting-hint">{role ? `@${role.name}` : "не выбрана"}</div>
            </div>
          </div>
          <div className="setting">
            <div className="setting-body">
              <div className="setting-title">Игровые серверы</div>
              <div className="setting-hint">
                {activeServers} подключено{servers.length > activeServers ? `, ${servers.length - activeServers} отключено` : ""} · код действует {settings.codeTtlMinutes} мин.
              </div>
            </div>
          </div>
        </div>
      </Section>

      <Section title="Последние привязки" action={<Link href="/link/links" className="btn small">Все привязки</Link>}>
        {recent.length === 0 ? (
          <EmptyState icon="link" title="Привязок пока нет" hint="Они появятся, когда игроки напишут /connect в игре и введут код в Discord." />
        ) : (
          <div className="card" style={{ padding: "8px 8px 4px" }}>
            <table className="table">
              <tbody>
                {recent.map((r) => (
                  <tr key={r.discordId}>
                    <td>
                      @{r.discordName} {!r.inGuild && <span className="chip warn">Вышел</span>}
                    </td>
                    <td>
                      <a href={steamProfileUrl(r.steamId)} target="_blank" rel="noopener noreferrer" className="member-link">
                        {r.steamName}
                      </a>
                    </td>
                    <td className="muted">{r.server?.name ?? "—"}</td>
                    <td className="muted">{when(r.linkedAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>
    </>
  );
}
