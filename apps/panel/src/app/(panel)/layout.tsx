import type { ReactNode } from "react";
import { Flame, LogOut } from "lucide-react";
import { prisma } from "@flamebot/core";
import { Icon } from "@/components/Icon";
import { NavLink } from "@/components/NavLink";
import { requirePage } from "@/lib/auth";
import { avatarUrl } from "@/lib/discord";
import { modules } from "@/modules";
import { logout } from "./actions";

export default async function PanelLayout({ children }: { children: ReactNode }) {
  const user = await requirePage();
  const guild = await prisma.guildInfo.findUnique({ where: { id: 1 } });

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark">
            <Flame size={18} aria-hidden="true" />
          </div>
          <div>
            <div className="brand-name">FlameBot</div>
            <div className="brand-sub">{guild?.name ?? "Сервер не подключён"}</div>
          </div>
        </div>

        <NavLink href="/" exact>
          <Icon name="home" /> Главная
        </NavLink>

        {modules.map((m) => (
          <div key={m.key}>
            <div className="nav-group">{m.title}</div>
            {m.nav.map((item) => (
              <NavLink key={item.href} href={item.href} exact={item.href === `/${m.key}`}>
                <Icon name={item.icon} /> {item.label}
              </NavLink>
            ))}
          </div>
        ))}

        <div className="nav-group">Панель</div>
        {user.level === "full" && (
          <NavLink href="/access">
            <Icon name="shield" /> Доступ
          </NavLink>
        )}
        <NavLink href="/audit">
          <Icon name="list" /> Журнал
        </NavLink>

        <div className="sidebar-footer">
          <div className="user-row">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img className="avatar" src={avatarUrl(user.id, user.avatarHash)} alt="" width={28} height={28} />
            <div style={{ minWidth: 0 }}>
              <div className="user-name">{user.username}</div>
              <div className="user-level">{user.level === "full" ? "Администратор" : "Модератор панели"}</div>
            </div>
          </div>
          <form action={logout}>
            <button type="submit" className="nav-link" style={{ width: "100%", background: "none", border: "none", cursor: "pointer", font: "inherit" }}>
              <LogOut size={16} aria-hidden="true" /> Выйти
            </button>
          </form>
        </div>
      </aside>
      <main className="main">{children}</main>
    </div>
  );
}
