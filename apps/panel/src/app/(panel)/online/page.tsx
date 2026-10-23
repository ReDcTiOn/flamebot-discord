import Link from "next/link";
import { formatNumber, prisma, type OnlineState } from "@flamebot/core";
import { AutoRefresh } from "@/components/AutoRefresh";
import { BotHeaderStatus } from "@/components/BotPower";
import { SetupChecklist } from "@/components/SetupChecklist";
import { getBotStates } from "@/lib/botState";
import { EmptyState, PageHead } from "@/components/Fields";
import { requirePage } from "@/lib/auth";

export const metadata = { title: "Онлайн серверов" };

const STATE: Record<OnlineState, { label: string; chip: string }> = {
  ONLINE: { label: "Онлайн", chip: "chip success" },
  STARTING: { label: "Запускается", chip: "chip warn" },
  OFFLINE: { label: "Выключен", chip: "chip danger" },
  DISABLED: { label: "Бот выключен", chip: "chip" },
};

function ago(d: Date | null | undefined): string {
  if (!d) return "ещё не отвечал";
  const s = Math.round((Date.now() - d.getTime()) / 1000);
  if (s < 60) return `${s} с назад`;
  if (s < 3600) return `${Math.round(s / 60)} мин назад`;
  return d.toLocaleString("ru-RU");
}

export default async function OnlineOverview() {
  const user = await requirePage();
  const botState = (await getBotStates(["online"])).online!;
  const [servers, problems] = await Promise.all([
    prisma.onlineServer.findMany({ orderBy: [{ sortOrder: "asc" }, { id: "asc" }], include: { status: true } }),
    prisma.botEvent.count({ where: { botKey: "online", level: { in: ["WARN", "ERROR"] }, createdAt: { gte: new Date(Date.now() - 86_400_000) } } }),
  ]);

  const online = servers.filter((s) => s.status?.state === "ONLINE");
  const players = online.reduce((n, s) => n + (s.status?.players ?? 0), 0);
  const slots = online.reduce((n, s) => n + (s.status?.maxPlayers ?? 0), 0);
  const queued = online.reduce((n, s) => n + (s.status?.queued ?? 0), 0);

  return (
    <>
      <PageHead title="Онлайн серверов" hint="Статусы игровых серверов в реальном времени.">
        <div className="head-actions">
          <AutoRefresh seconds={5} />
          <BotHeaderStatus botKey="online" title="Онлайн серверов" state={botState} canControl={user.level === "full"} />
        </div>
      </PageHead>

      <SetupChecklist
        items={[{ done: servers.length > 0, text: "Игровые серверы", hint: "бот показывает онлайн тех серверов, что добавлены здесь", href: "/online/servers", linkLabel: "Добавить" }]}
        problems={problems}
        historyHref="/online/events?level=problems"
      />

      <div className="grid grid-4" style={{ marginBottom: 20 }}>
        <div className="metric"><div className="metric-label">Серверов онлайн</div><div className="metric-value">{online.length} / {servers.filter((s) => s.enabled).length}</div></div>
        <div className="metric"><div className="metric-label">Игроков сейчас</div><div className="metric-value">{formatNumber(players)}</div></div>
        <div className="metric"><div className="metric-label">Слотов</div><div className="metric-value">{formatNumber(slots)}</div></div>
        <div className="metric"><div className="metric-label">В очереди</div><div className="metric-value">{formatNumber(queued)}</div></div>
      </div>

      {servers.length === 0 ? (
        <EmptyState icon="server" title="Серверов пока нет" hint="Добавь их в разделе «Серверы»." />
      ) : (
        <div className="server-grid">
          {servers.map((s) => {
            const st = s.status;
            const state: OnlineState = s.enabled ? (st?.state ?? "OFFLINE") : "DISABLED";
            const fill = st?.maxPlayers ? Math.min(100, Math.round(((st.players ?? 0) / st.maxPlayers) * 100)) : 0;
            return (
              <div key={s.id} className={`server-card state-${state.toLowerCase()}`}>
                <div className="server-card-head">
                  <div style={{ minWidth: 0 }}>
                    <div className="setting-title">{s.name}</div>
                    <div className="muted" style={{ fontSize: 12 }}>{s.host}:{s.port}</div>
                  </div>
                  <span className={STATE[state].chip}>
                    <span className="dot" style={{ background: "currentColor" }} />
                    {STATE[state].label}
                  </span>
                </div>
                {state === "ONLINE" ? (
                  <>
                    <div className="server-players">
                      <b>{formatNumber(st?.players ?? 0)}</b> / {formatNumber(st?.maxPlayers ?? 0)}
                      {st?.queued ? <span className="chip warn" style={{ marginLeft: 8 }}>{st.queued} в очереди</span> : null}
                    </div>
                    <div className="mini-progress"><div style={{ width: `${fill}%` }} /></div>
                  </>
                ) : (
                  <div className="server-players muted">—</div>
                )}
                <div className="server-meta">
                  <span>Бот: {st?.botTag ?? "не вошёл"}</span>
                  <span>Ответ: {ago(st?.lastSeenAt)}</span>
                </div>
                {(st?.botError || (state === "OFFLINE" && st?.rconError)) && (
                  <div className="server-error">{st?.botError ?? `RCON: ${st?.rconError}`}</div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}
