import Link from "next/link";
import { AlertCircle } from "lucide-react";
import { prisma } from "@flamebot/core";
import { AutoRefresh } from "@/components/AutoRefresh";
import { BotStatusLine, BotSwitch } from "@/components/BotPower";
import { PageHead } from "@/components/Fields";
import { Icon } from "@/components/Icon";
import { requirePage } from "@/lib/auth";
import { getBotStates } from "@/lib/botState";
import { modules } from "@/modules";

export const metadata = { title: "Главная" };

export default async function HomePage() {
  const user = await requirePage();
  const [states, guild] = await Promise.all([getBotStates(modules.map((m) => m.key)), prisma.guildInfo.findUnique({ where: { id: 1 } })]);
  const working = modules.filter((m) => states[m.key]!.tone === "on").length;
  const server = guild ? `${guild.name} · ${guild.memberCount.toLocaleString("ru-RU")} участников` : "Ни один бот ещё не подключился к серверу";

  return (
    <>
      <PageHead title="Боты сервера" hint={`${server} · работают ${working} из ${modules.length}`}>
        <AutoRefresh seconds={5} />
      </PageHead>

      <div className="tiles">
        {modules.map((m) => {
          const state = states[m.key]!;
          const className = state.problem ? "setting problem" : state.tone === "paused" ? "setting dimmed" : "setting";
          return (
            <div key={m.key} className={className}>
              <Link href={`/${m.key}`} className="bot-mark" style={{ background: m.color }} aria-label={m.title}>
                <Icon name={m.icon} size={20} />
              </Link>
              <Link href={`/${m.key}`} className="setting-body">
                <div className="setting-title">{m.title}</div>
                {state.problem ? (
                  <div className="setting-error">
                    <AlertCircle size={14} aria-hidden="true" style={{ flexShrink: 0, marginTop: 2 }} />
                    {state.label}: {state.detail}
                  </div>
                ) : (
                  <div className="setting-hint">{state.tone === "paused" && state.detail ? state.detail : m.description}</div>
                )}
              </Link>
              <div className="bot-row-actions">
                {state.problem ? (
                  state.fix && (
                    <Link href={state.fix.href} className="btn small">
                      {state.fix.label}
                    </Link>
                  )
                ) : (
                  <BotStatusLine state={state} />
                )}
                {user.level === "full" && <BotSwitch botKey={m.key} title={m.title} state={state} />}
              </div>
            </div>
          );
        })}
      </div>
      {user.level !== "full" && (
        <p className="muted" style={{ fontSize: 12.5, marginTop: 12 }}>Включать и выключать ботов могут только администраторы сервера.</p>
      )}
    </>
  );
}
