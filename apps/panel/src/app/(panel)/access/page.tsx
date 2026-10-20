import { getPanelSettings, prisma } from "@flamebot/core";
import { ActionForm, SubmitButton } from "@/components/ActionForm";
import { requirePage } from "@/lib/auth";
import { listRoles, roleColor } from "@/lib/guild";
import { revokeAllSessions, saveAccess } from "../actions";
import { DangerZone, PageHead } from "@/components/Fields";

export const metadata = { title: "Доступ" };

export default async function AccessPage() {
  await requirePage("full");
  const [settings, roles, sessions] = await Promise.all([
    getPanelSettings(prisma),
    listRoles(),
    prisma.adminSession.findMany({ where: { expiresAt: { gt: new Date() } }, orderBy: { createdAt: "desc" } }),
  ]);
  const assignable = roles.filter((r) => !r.managed);

  return (
    <>
      <PageHead title="Доступ к панели" hint="Владелец сервера и роли с правом «Администратор» видят всё. Право «Управлять сервером» и роли ниже дают доступ ко всему, кроме этой страницы." />

      <div className="card">
        <div className="card-head">
          <div>
            <h2>Роли с доступом</h2>
            <p>Отметь роли модераторов, которым нужна панель.</p>
          </div>
        </div>
        {assignable.length === 0 ? (
          <p className="empty">Список ролей появится, когда бот подключится к серверу.</p>
        ) : (
          <ActionForm action={saveAccess}>
            <div className="check-list">
              {assignable.map((r) => (
                <label key={r.id} className="check-item">
                  <input type="checkbox" name="panelRoleIds" value={r.id} defaultChecked={settings.panelRoleIds.includes(r.id)} />
                  <span className="dot" style={{ background: roleColor(r.color) }} />
                  {r.name}
                </label>
              ))}
            </div>
            <div className="form-actions">
              <SubmitButton>Сохранить</SubmitButton>
            </div>
          </ActionForm>
        )}
      </div>

      <div className="card">
        <div className="card-head">
          <div>
            <h2>Активные сессии</h2>
            <p>Кто сейчас вошёл в панель и до какого времени действует вход.</p>
          </div>
        </div>
        <table className="table">
          <thead>
            <tr>
              <th>Пользователь</th>
              <th>Уровень</th>
              <th>Вход</th>
              <th>Истекает</th>
            </tr>
          </thead>
          <tbody>
            {sessions.map((s) => (
              <tr key={s.id}>
                <td>
                  {s.username} <span className="muted">{s.userId}</span>
                </td>
                <td>{s.isGuildAdmin ? <span className="chip accent">Администратор</span> : <span className="chip">Модератор</span>}</td>
                <td className="secondary">{s.createdAt.toLocaleString("ru-RU")}</td>
                <td className="secondary">{s.expiresAt.toLocaleString("ru-RU")}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <DangerZone
        title="Завершить все сессии"
        action={
          <ActionForm action={revokeAllSessions} confirm="Завершить все сессии, кроме твоей?" confirmLabel="Завершить" danger>
            <SubmitButton variant="danger-solid">Завершить</SubmitButton>
          </ActionForm>
        }
      >
        Если подозреваешь, что кто-то получил доступ. Все, кроме тебя, выйдут из панели и войдут заново через Discord.
      </DangerZone>
    </>
  );
}
