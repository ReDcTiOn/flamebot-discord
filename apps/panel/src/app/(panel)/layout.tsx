import type { ReactNode } from "react";
import { prisma } from "@flamebot/core";
import { PanelNav } from "@/components/PanelNav";
import { ToastProvider } from "@/components/ui/Toast";
import { requirePage } from "@/lib/auth";
import { avatarUrl } from "@/lib/discord";
import { logout } from "./actions";

const ONLINE_MS = 3 * 60_000;

export default async function PanelLayout({ children }: { children: ReactNode }) {
  const user = await requirePage();
  const [guild, statuses] = await Promise.all([
    prisma.guildInfo.findUnique({ where: { id: 1 } }),
    prisma.botStatus.findMany(),
  ]);
  const online = Object.fromEntries(statuses.map((s) => [s.botKey, Date.now() - s.heartbeatAt.getTime() < ONLINE_MS]));

  return (
    <ToastProvider>
      <div className="shell">
        <PanelNav
          user={{ username: user.username, avatar: avatarUrl(user.id, user.avatarHash), full: user.level === "full" }}
          guildName={guild?.name ?? null}
          online={online}
          logout={logout}
        />
        <main className="main">{children}</main>
      </div>
    </ToastProvider>
  );
}
