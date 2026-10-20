import { Plus } from "lucide-react";
import { prisma, type OnlineServer } from "@flamebot/core";
import { ActionForm, SubmitButton } from "@/components/ActionForm";
import { DangerZone, EmptyState, PageHead, Section } from "@/components/Fields";
import { Icon } from "@/components/Icon";
import { SecretField } from "@/components/SecretField";
import { ModalCancel, ModalTrigger } from "@/components/ui/Modal";
import { requirePage } from "@/lib/auth";
import { createServer, deleteServer, updateServer } from "../actions";

export const metadata = { title: "Серверы" };

// Безопасный вид сервера для формы: без зашифрованных секретов.
type ServerView = Pick<OnlineServer, "id" | "name" | "host" | "port" | "enabled" | "sortOrder"> & {
  hasRcon: boolean;
  hasToken: boolean;
  secretsAt: string | null;
};

function ServerFields({ s }: { s?: ServerView }) {
  return (
    <div className="form-grid">
      <label className="stack">
        <span>Название</span>
        <input type="text" name="name" defaultValue={s?.name} required maxLength={60} className="wide" placeholder="FLAME RUST #1 · Main" />
      </label>
      <div className="grid" style={{ gridTemplateColumns: "1fr 140px" }}>
        <label className="stack">
          <span>IP или адрес сервера</span>
          <input type="text" name="host" defaultValue={s?.host} required maxLength={253} className="wide" placeholder="46.174.53.23" />
        </label>
        <label className="stack">
          <span>Порт RCON</span>
          <input type="number" name="port" defaultValue={s?.port} required min={1} max={65535} className="wide" placeholder="28016" />
        </label>
      </div>
      <SecretField name="rconPassword" label="Пароль RCON" placeholder="Пароль из rcon.password" saved={!!s?.hasRcon} savedAt={s?.secretsAt} required />
      <SecretField name="discordToken" label="Токен бота Discord" placeholder="Bot → Reset Token в Developer Portal" saved={!!s?.hasToken} savedAt={s?.secretsAt} required />
      <div className="grid grid-2" style={{ alignItems: "end" }}>
        <label className="stack">
          <span>Порядок в списке</span>
          <input type="number" name="sortOrder" defaultValue={s?.sortOrder ?? 0} min={-1000} max={1000} className="wide" />
        </label>
        <label className="check-row" style={{ minHeight: 34 }}>
          <input type="checkbox" name="enabled" defaultChecked={s?.enabled ?? true} /> Бот работает
        </label>
      </div>
      <p className="muted" style={{ fontSize: 12.5 }}>
        Пароль и токен шифруются ключом бота онлайна сразу при сохранении. Панель не может их показать: их читает только сам бот.
      </p>
    </div>
  );
}

export default async function OnlineServersPage() {
  await requirePage();
  const [rows, key] = await Promise.all([
    prisma.onlineServer.findMany({ orderBy: [{ sortOrder: "asc" }, { id: "asc" }], include: { status: true } }),
    prisma.botPublicKey.findUnique({ where: { botKey: "online" } }),
  ]);
  const servers: (ServerView & { status: (typeof rows)[number]["status"] })[] = rows.map((r) => ({
    id: r.id,
    name: r.name,
    host: r.host,
    port: r.port,
    enabled: r.enabled,
    sortOrder: r.sortOrder,
    hasRcon: !!r.rconPasswordEnc,
    hasToken: !!r.discordTokenEnc,
    secretsAt: r.secretsUpdatedAt?.toLocaleString("ru-RU") ?? null,
    status: r.status,
  }));

  return (
    <>
      <PageHead title="Серверы" hint="Каждый игровой сервер — отдельный Discord-бот, который показывает онлайн у себя в статусе.">
        <ModalTrigger
          label={
            <>
              <Plus size={16} aria-hidden="true" /> Добавить сервер
            </>
          }
          buttonClass="btn primary"
          title="Новый сервер"
          description="Нужны адрес и порт RCON, пароль RCON и токен отдельного бота Discord."
          size="lg"
        >
          <ActionForm action={createServer} resetOnSuccess>
            <ServerFields />
            <div className="modal-actions">
              <ModalCancel />
              <SubmitButton>Добавить</SubmitButton>
            </div>
          </ActionForm>
        </ModalTrigger>
      </PageHead>

      {!key && (
        <p className="notice warn">
          Бот онлайна ещё ни разу не запускался, поэтому у панели нет ключа шифрования. Запусти бота, и можно будет сохранять пароли и токены.
        </p>
      )}

      {servers.length === 0 ? (
        <EmptyState icon="server" title="Серверов пока нет" hint="Нажми «Добавить сервер», чтобы подключить первый." />
      ) : (
        <Section title={`Серверы · ${servers.length}`}>
          <div className="tiles">
            {servers.map((s) => (
              <div key={s.id} className="setting">
                <div className="setting-icon">
                  <Icon name="server" />
                </div>
                <div className="setting-body">
                  <div className="setting-title">{s.name}</div>
                  <div className="setting-hint">
                    {s.host}:{s.port}
                    {!s.hasRcon && " · нет пароля RCON"}
                    {!s.hasToken && " · нет токена"}
                    {s.status?.botTag ? ` · бот ${s.status.botTag}` : ""}
                  </div>
                </div>
                <div className="row-actions">
                  {!s.enabled ? <span className="chip">Выключен</span> : null}
                  <ModalTrigger label="Изменить" buttonClass="btn small" title={s.name} description={`${s.host}:${s.port}`} size="lg">
                    <ActionForm action={updateServer}>
                      <input type="hidden" name="id" value={s.id} />
                      <ServerFields s={s} />
                      <div className="modal-actions">
                        <ModalCancel />
                        <SubmitButton>Сохранить</SubmitButton>
                      </div>
                    </ActionForm>
                    <DangerZone
                      title="Удалить сервер"
                      action={
                        <ActionForm action={deleteServer} confirm={`Удалить сервер «${s.name}»?`} confirmLabel="Удалить" danger>
                          <input type="hidden" name="id" value={s.id} />
                          <SubmitButton variant="danger-solid">Удалить</SubmitButton>
                        </ActionForm>
                      }
                    >
                      Бот этого сервера отключится, пароль и токен удалятся из базы.
                    </DangerZone>
                  </ModalTrigger>
                </div>
              </div>
            ))}
          </div>
        </Section>
      )}
    </>
  );
}
