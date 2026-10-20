"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, type ReactNode } from "react";
import { Flame, LogOut, Plus } from "lucide-react";
import { Icon } from "@/components/Icon";
import { moduleForPath, modules, type IconName } from "@/modules";

function SideLink({ href, icon, children, exact = false }: { href: string; icon: IconName; children: ReactNode; exact?: boolean }) {
  const pathname = usePathname();
  const active = exact ? pathname === href : pathname === href || pathname.startsWith(`${href}/`);
  return (
    <Link href={href} className={active ? "side-link active" : "side-link"} aria-current={active ? "page" : undefined}>
      <Icon name={icon} /> {children}
    </Link>
  );
}

export function PanelNav({
  user,
  guildName,
  online,
  logout,
}: {
  user: { username: string; avatar: string; full: boolean };
  guildName: string | null;
  online: Record<string, "on" | "paused" | "pending" | "off">;
  logout: () => Promise<void>;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const current = moduleForPath(pathname);
  const searchRef = useRef<HTMLInputElement>(null);

  // Ctrl+K — быстрый поиск игрока.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        searchRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <>
      <nav className="rail" aria-label="Боты">
        <Link href="/" className={pathname === "/" ? "rail-item home active" : "rail-item home"} title="FlameBot: все боты">
          <Flame size={20} aria-hidden="true" />
        </Link>
        <div className="rail-sep" />
        {modules.map((m) => {
          const active = current?.key === m.key;
          return (
            <Link
              key={m.key}
              href={`/${m.key}`}
              className={active ? "rail-item active" : "rail-item"}
              style={{ background: m.color }}
              title={m.title}
              aria-label={m.title}
            >
              <Icon name={m.icon} size={20} />
              <span className={`rail-status ${online[m.key] ?? "off"}`} aria-hidden="true" />
            </Link>
          );
        })}
        <span className="rail-item add" title="Новые боты подключаются в коде, инструкция в README">
          <Plus size={18} aria-hidden="true" />
        </span>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img className="rail-avatar" src={user.avatar} alt={user.username} width={36} height={36} title={user.username} />
      </nav>

      <aside className="sidebar">
        <div className="side-head">
          <div className="side-title">{current?.title ?? "FlameBot"}</div>
          <div className="side-sub">{guildName ?? "Сервер не подключён"}</div>
        </div>

        <form
          className="side-search"
          role="search"
          onSubmit={(e) => {
            e.preventDefault();
            const q = searchRef.current?.value.trim() ?? "";
            router.push(`/rating/members${q ? `?q=${encodeURIComponent(q)}` : ""}`);
          }}
        >
          <Icon name="search" size={15} />
          <input ref={searchRef} type="search" placeholder="Найти игрока…" aria-label="Найти игрока" maxLength={64} />
          <kbd>Ctrl</kbd>
          <kbd>K</kbd>
        </form>

        {current ? (
          current.sections.map((s, i) => (
            <div key={s.title ?? i} className="side-group">
              {s.title && <div className="side-label">{s.title}</div>}
              {s.items.map((item) => (
                <SideLink key={item.href} href={item.href} icon={item.icon} exact={item.href === `/${current.key}`}>
                  {item.label}
                </SideLink>
              ))}
            </div>
          ))
        ) : (
          <div className="side-group">
            <SideLink href="/" icon="home" exact>
              Все боты
            </SideLink>
          </div>
        )}

        <div className="side-group">
          <div className="side-label">Панель</div>
          {user.full && (
            <SideLink href="/access" icon="shield">
              Доступ
            </SideLink>
          )}
          <SideLink href="/audit" icon="list">
            Журнал действий
          </SideLink>
        </div>

        <div className="side-foot">
          <div className="side-user">
            <div className="side-user-name">{user.username}</div>
            <div className="side-user-role">{user.full ? "Администратор" : "Модератор панели"}</div>
          </div>
          <form action={logout}>
            <button type="submit" className="icon-btn" title="Выйти" aria-label="Выйти">
              <LogOut size={16} aria-hidden="true" />
            </button>
          </form>
        </div>
      </aside>
    </>
  );
}
