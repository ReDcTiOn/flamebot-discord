import Link from "next/link";
import { prisma } from "@flamebot/core";
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
      <div className="page-head">
        <div>
          <h1>Боты сервера</h1>
          <p>
            {guild ? `${guild.name} · ${guild.memberCount.toLocaleString("ru-RU")} участников` : "Ни один бот ещё не подключился к серверу"}
          </p>
        </div>
      </div>

      <div className="grid grid-2">
        {modules.map((m) => {
          const status = byKey.get(m.key);
          const online = status && Date.now() - status.heartbeatAt.getTime() < ONLINE_MS;
          return (
            <Link key={m.key} href={m.nav[0]?.href ?? "/"} className="card" style={{ display: "block", marginBottom: 0 }}>
              <div className="card-head" style={{ marginBottom: 8 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <div className="brand-mark">
                    <Icon name={m.icon} size={18} />
                  </div>
                  <h2>{m.title}</h2>
                </div>
                <span className={online ? "chip success" : "chip danger"}>
                  <span className="dot" style={{ background: "currentColor" }} />
                  {online ? "Онлайн" : status ? "Не отвечает" : "Не запускался"}
                </span>
              </div>
              <p className="secondary">{m.description}</p>
            </Link>
          );
        })}
      </div>
    </>
  );
}
