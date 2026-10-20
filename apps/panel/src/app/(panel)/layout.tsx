import type { ReactNode } from "react";
import { prisma } from "@flamebot/core";
import { PanelNav } from "@/components/PanelNav";
import { ToastProvider } from "@/components/ui/Toast";
import { requirePage } from "@/lib/auth";
import { getBotStates } from "@/lib/botState";
import { avatarUrl } from "@/lib/discord";
import { modules } from "@/modules";
import { logout } from "./actions";

export default async function PanelLayout({ children }: { children: ReactNode }) {
  const user = await requirePage();
  const [guild, states] = await Promise.all([prisma.guildInfo.findUnique({ where: { id: 1 } }), getBotStates(modules.map((m) => m.key))]);
  const online = Object.fromEntries(Object.entries(states).map(([k, s]) => [k, s.tone]));

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
