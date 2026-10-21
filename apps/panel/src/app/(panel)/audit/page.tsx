import Link from "next/link";
import { prisma } from "@flamebot/core";
import { ModalTrigger } from "@/components/ui/Modal";
import { requirePage } from "@/lib/auth";
import { modules } from "@/modules";
import { PageHead } from "@/components/Fields";

export const metadata = { title: "Журнал" };

const PAGE_SIZE = 50;

const ACTIONS: Record<string, string> = {
  login: "Вход в панель",
  "login.denied": "Отказ во входе",
  logout: "Выход",
  "access.update": "Изменил доступ к панели",
  "sessions.revoke_all": "Завершил все сессии",
  "bot.token.set": "Задал токен бота",
  "bot.token.clear": "Удалил токен бота",
  "xp.update": "Изменил настройки опыта",
  "rep.update": "Изменил настройки репутации",
  "channels.update": "Изменил каналы",
  "messages.update": "Изменил тексты сообщений",
  "rank.create": "Добавил ранг",
  "rank.update": "Изменил ранг",
  "rank.delete": "Удалил ранг",
  "shop.create": "Добавил товар",
  "shop.update": "Изменил товар",
  "shop.delete": "Удалил товар",
  "member.adjust": "Изменил баланс игрока",
  "member.reset": "Обнулил игрока",
  "member.badge.add": "Выдал бейдж",
  "member.badge.remove": "Снял бейдж",
  "purchase.end": "Досрочно завершил покупку",
  "online.server.create": "Добавил сервер",
  "online.server.update": "Изменил сервер",
  "online.server.delete": "Удалил сервер",
  "online.settings": "Изменил настройки онлайна",
  "giveaway.settings": "Изменил настройки розыгрышей",
  "giveaway.create": "Создал розыгрыш",
  "giveaway.finish": "Досрочно подвёл итоги розыгрыша",
  "giveaway.cancel": "Отменил розыгрыш",
  "bot.start": "Запустил бота",
  "bot.stop": "Остановил бота",
  "card.update": "Изменил карточку профиля",
  "card.toggle": "Переключил вид /profile",
  "card.upload": "Загрузил картинку для карточки",
  "customrole.settings": "Изменил проверку личных ролей",
  "customrole.approve": "Одобрил личную роль",
  "customrole.reject": "Отклонил личную роль",
  "customrole.expire": "Заявка на личную роль истекла",
};

export default async function AuditPage({ searchParams }: { searchParams: Promise<{ module?: string; page?: string }> }) {
  await requirePage();
  const params = await searchParams;
  const moduleKeys = ["panel", ...modules.map((m) => m.key)];
  const moduleFilter = params.module && moduleKeys.includes(params.module) ? params.module : undefined;
  const page = Math.max(1, Math.min(1000, Number.parseInt(params.page ?? "1", 10) || 1));

  const where = moduleFilter ? { module: moduleFilter } : {};
  const [rows, total] = await Promise.all([
    prisma.auditLog.findMany({ where, orderBy: { createdAt: "desc" }, take: PAGE_SIZE, skip: (page - 1) * PAGE_SIZE }),
    prisma.auditLog.count({ where }),
  ]);
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const titles: Record<string, string> = { panel: "Панель", ...Object.fromEntries(modules.map((m) => [m.key, m.title])) };
  const link = (p: number, m?: string) => `/audit?${new URLSearchParams({ ...(m ? { module: m } : {}), page: String(p) })}`;

  return (
    <>
      <PageHead title="Журнал действий" hint="Кто, когда и что менял в панели. Записи не редактируются и не удаляются из интерфейса." />

      <div style={{ display: "flex", gap: 6, marginBottom: 12, flexWrap: "wrap" }}>
        <Link href={link(1)} className={!moduleFilter ? "chip accent" : "chip"}>Все</Link>
        {moduleKeys.map((k) => (
          <Link key={k} href={link(1, k)} className={moduleFilter === k ? "chip accent" : "chip"}>
            {titles[k]}
          </Link>
        ))}
      </div>

      <div className="card">
        {rows.length === 0 ? (
          <p className="empty">Записей пока нет.</p>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Когда</th>
                <th>Кто</th>
                <th>Раздел</th>
                <th>Действие</th>
                <th>Подробности</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td className="secondary" style={{ whiteSpace: "nowrap" }}>{r.createdAt.toLocaleString("ru-RU")}</td>
                  <td>{r.actorName}</td>
                  <td><span className="chip">{titles[r.module] ?? r.module}</span></td>
                  <td>
                    {ACTIONS[r.action] ?? r.action}
                    {r.target && <span className="muted"> · {r.target}</span>}
                  </td>
                  <td>
                    {r.details ? (
                      <ModalTrigger
                        label="Подробнее"
                        buttonClass="btn small"
                        title={ACTIONS[r.action] ?? r.action}
                        description={`${r.actorName} · ${r.createdAt.toLocaleString("ru-RU")}${r.target ? ` · ${r.target}` : ""}`}
                      >
                        <pre className="json-view">{JSON.stringify(r.details, null, 2)}</pre>
                      </ModalTrigger>
                    ) : (
                      <span className="muted">—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <div className="pager">
          <span>Страница {page} из {pages}</span>
          <span style={{ display: "flex", gap: 8 }}>
            {page > 1 && <Link className="btn small" href={link(page - 1, moduleFilter)}>Назад</Link>}
            {page < pages && <Link className="btn small" href={link(page + 1, moduleFilter)}>Дальше</Link>}
          </span>
        </div>
      </div>
    </>
  );
}
