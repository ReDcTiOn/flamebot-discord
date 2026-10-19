import Link from "next/link";
import { prisma } from "@flamebot/core";
import { PageHead } from "@/components/Fields";
import { Icon } from "@/components/Icon";
import { requirePage } from "@/lib/auth";
import { modules } from "@/modules";

export const metadata = { title: "Главная" };

const ONLINE_MS = 3 * 60_000;

export default async function HomePage() {
  await requirePage();
  const [statuses, guild] = await Promise.all([
    prisma.botStatus.findMany(),
    prisma.guildInfo.findUnique({ where: { id: 1 } }),
  ]);
  const byKey = new Map(statuses.map((s) => [s.botKey, s]));

  return (
    <>
      <PageHead
        title="Боты сервера"
        hint={guild ? `${guild.name} · ${guild.memberCount.toLocaleString("ru-RU")} участников` : "Ни один бот ещё не подключился к серверу"}
      />

      <div className="tiles">
        {modules.map((m) => {
          const status = byKey.get(m.key);
          const online = status && Date.now() - status.heartbeatAt.getTime() < ONLINE_MS;
          return (
            <Link key={m.key} href={`/${m.key}`} className="setting">
              <div className="bot-mark" style={{ background: m.color }}>
                <Icon name={m.icon} size={20} />
              </div>
              <div className="setting-body">
                <div className="setting-title">{m.title}</div>
                <div className="setting-hint">{m.description}</div>
              </div>
              <div className="setting-control">
                <span className={online ? "chip success" : "chip danger"}>
                  <span className="dot" style={{ background: "currentColor" }} />
                  {online ? "Онлайн" : status ? "Не отвечает" : "Не запускался"}
                </span>
              </div>
            </Link>
          );
        })}
      </div>
    </>
  );
}
