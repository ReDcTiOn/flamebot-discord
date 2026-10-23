import Link from "next/link";
import { formatNumber, getLinkSettings, prisma, steamProfileUrl } from "@flamebot/core";
import { AutoRefresh } from "@/components/AutoRefresh";
import { BotHeaderStatus } from "@/components/BotPower";
import { SetupChecklist, type SetupItem } from "@/components/SetupChecklist";
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
  const [botState, token, settings, total, week, left, pending, servers, recent, problems] = await Promise.all([
    getBotStates(["link"]).then((s) => s.link!),
    prisma.botCredential.findUnique({ where: { botKey: "link" }, select: { discordTokenEnc: true } }),
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
  const setup: SetupItem[] = [
    { done: !!token?.discordTokenEnc, text: "Токен бота Discord", href: full ? "/link/connection" : null, linkLabel: "Подключение", error: !token?.discordTokenEnc },
    { done: !!settings.channelId, text: "Канал с кнопкой «Привязать»", href: "/link/settings", linkLabel: "Выбрать" },
    { done: !!settings.roleId, text: "Роль за привязку", hint: "без неё аккаунты свяжутся, но роль никто не получит", href: "/link/settings", linkLabel: "Выбрать" },
    { done: activeServers > 0, text: "Игровой сервер для /connect", href: full ? "/link/servers" : null, linkLabel: "Добавить" },
  ];

  return (
    <>
      <PageHead title="Привязка Steam" hint="Игрок пишет /connect на любом сервере RUST, нажимает «Привязать» в Discord и вводит код. Связка общая для всех серверов.">
        <div className="head-actions">
          <AutoRefresh seconds={10} />
          <BotHeaderStatus botKey="link" title="Привязка Steam" state={botState} canControl={full} />
        </div>
      </PageHead>

      <SetupChecklist items={setup} problems={problems} historyHref="/link/events?level=problems" />

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
