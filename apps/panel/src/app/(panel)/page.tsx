import Link from "next/link";
import { prisma } from "@flamebot/core";
import { AutoRefresh } from "@/components/AutoRefresh";
import { BotPower } from "@/components/BotPower";
import { PageHead } from "@/components/Fields";
import { Icon } from "@/components/Icon";
import { requirePage } from "@/lib/auth";
import { getBotStates } from "@/lib/botState";
import { modules } from "@/modules";

export const metadata = { title: "Главная" };

export default async function HomePage() {
  const user = await requirePage();
  const [states, guild] = await Promise.all([getBotStates(modules.map((m) => m.key)), prisma.guildInfo.findUnique({ where: { id: 1 } })]);

  return (
    <>
      <PageHead
        title="Боты сервера"
        hint={guild ? `${guild.name} · ${guild.memberCount.toLocaleString("ru-RU")} участников` : "Ни один бот ещё не подключился к серверу"}
      >
        <AutoRefresh seconds={5} />
      </PageHead>

      <div className="tiles">
        {modules.map((m) => (
          <div key={m.key} className="setting">
            <Link href={`/${m.key}`} className="bot-mark" style={{ background: m.color }} aria-label={m.title}>
              <Icon name={m.icon} size={20} />
            </Link>
            <Link href={`/${m.key}`} className="setting-body">
              <div className="setting-title">{m.title}</div>
              <div className="setting-hint">{m.description}</div>
            </Link>
            <div className="setting-control">
              <BotPower botKey={m.key} title={m.title} state={states[m.key]!} canControl={user.level === "full"} />
            </div>
          </div>
        ))}
      </div>
      {user.level !== "full" && (
        <p className="muted" style={{ fontSize: 12.5, marginTop: 12 }}>Запускать и останавливать ботов могут только администраторы сервера.</p>
      )}
    </>
  );
}
