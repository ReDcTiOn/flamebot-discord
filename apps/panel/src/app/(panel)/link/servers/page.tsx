import { Plus } from "lucide-react";
import { formatNumber, prisma } from "@flamebot/core";
import { ActionForm, SubmitButton } from "@/components/ActionForm";
import { DangerZone, EmptyState, PageHead, Section } from "@/components/Fields";
import { Icon } from "@/components/Icon";
import { LinkKeyForm } from "@/components/LinkKeyForm";
import { ModalCancel, ModalTrigger } from "@/components/ui/Modal";
import { requirePage } from "@/lib/auth";
import { linkApiUrl, when } from "@/lib/link";
import { createLinkServer, deleteLinkServer, resetLinkServerKey, updateLinkServer } from "../actions";

export const metadata = { title: "Игровые серверы" };

// Сервер шлёт запросы раз в несколько минут, пока на нём есть игроки. Дольше суток тишины — повод проверить плагин.
const QUIET_MS = 24 * 60 * 60_000;

export default async function LinkServersPage() {
  await requirePage("full");
  const apiUrl = linkApiUrl();
  const servers = await prisma.linkServer.findMany({ orderBy: { id: "asc" }, include: { _count: { select: { links: true } } } });

  return (
    <>
      <PageHead title="Игровые серверы" hint="У каждого сервера RUST свой ключ API для плагина FDiscordLink. Ключ показывается один раз, в базе хранится только его отпечаток.">
        <ModalTrigger
          label={
            <>
              <Plus size={16} aria-hidden="true" /> Добавить сервер
            </>
          }
          buttonClass="btn primary"
          title="Новый сервер"
          description="Название видно только в панели. После создания появится ключ API для конфига плагина."
        >
          <LinkKeyForm action={createLinkServer} apiUrl={apiUrl} submitLabel="Создать ключ">
            <label className="stack">
              <span>Название</span>
              <input type="text" name="name" required maxLength={60} className="wide" placeholder="FLAME RUST #1 · Main" />
            </label>
          </LinkKeyForm>
        </ModalTrigger>
      </PageHead>

      <Section title="Как подключить сервер" hint="Один раз на каждый сервер.">
        <div className="card" style={{ padding: "14px 16px", fontSize: 13, lineHeight: 1.6 }}>
          <ol style={{ margin: 0, paddingLeft: 18 }}>
            <li>
              Положи <code>FDiscordLink.cs</code> из папки <code>plugins/carbon</code> репозитория в <code>carbon/plugins</code> на сервере.
            </li>
            <li>Нажми «Добавить сервер» и скопируй строки для конфига.</li>
            <li>
              Вставь их в <code>carbon/configs/FDiscordLink.json</code> и выполни в консоли <code>c.reload FDiscordLink</code>.
            </li>
            <li>
              Проверь связь командой <code>discordlink.check</code> в консоли сервера.
            </li>
          </ol>
          <p className="muted" style={{ margin: "8px 0 0" }}>
            Адрес API: <code>{apiUrl}</code>
          </p>
        </div>
      </Section>

      {servers.length === 0 ? (
        <EmptyState icon="server" title="Серверов пока нет" hint="Нажми «Добавить сервер», чтобы получить ключ для первого." />
      ) : (
        <Section title={`Серверы · ${servers.length}`}>
          <div className="tiles">
            {servers.map((s) => {
              const quiet = !s.lastSeenAt || Date.now() - s.lastSeenAt.getTime() > QUIET_MS;
              return (
                <div key={s.id} className="setting">
                  <div className="setting-icon">
                    <Icon name="server" />
                  </div>
                  <div className="setting-body">
                    <div className="setting-title">{s.name}</div>
                    <div className="setting-hint">
                      Ключ <code>{s.keyHint}</code> · {s.lastSeenAt ? `запрос ${when(s.lastSeenAt)}` : "запросов ещё не было"} · привязок через него:{" "}
                      {formatNumber(s._count.links)}
                    </div>
                  </div>
                  <div className="row-actions">
                    {!s.enabled ? <span className="chip">Отключён</span> : quiet ? <span className="chip warn">Нет запросов</span> : <span className="chip success">На связи</span>}
                    <ModalTrigger label="Изменить" buttonClass="btn small" title={s.name} description={`Ключ ${s.keyHint}`}>
                      <ActionForm action={updateLinkServer}>
                        <input type="hidden" name="id" value={s.id} />
                        <div className="form-grid">
                          <label className="stack">
                            <span>Название</span>
                            <input type="text" name="name" defaultValue={s.name} required maxLength={60} className="wide" />
                          </label>
                          <label className="check-row">
                            <input type="checkbox" name="enabled" defaultChecked={s.enabled} /> Принимать запросы от сервера
                          </label>
                        </div>
                        <div className="modal-actions">
                          <ModalCancel />
                          <SubmitButton>Сохранить</SubmitButton>
                        </div>
                      </ActionForm>
                      <DangerZone
                        title="Удалить сервер"
                        action={
                          <ActionForm action={deleteLinkServer} confirm={`Удалить сервер «${s.name}»?`} confirmLabel="Удалить" danger>
                            <input type="hidden" name="id" value={s.id} />
                            <SubmitButton variant="danger-solid">Удалить</SubmitButton>
                          </ActionForm>
                        }
                      >
                        Ключ перестанет работать, /connect на этом сервере выдаст ошибку. Привязки игроков останутся.
                      </DangerZone>
                    </ModalTrigger>
                    <ModalTrigger
                      label="Новый ключ"
                      buttonClass="btn small"
                      title={`Новый ключ: ${s.name}`}
                      description="Старый ключ перестанет работать в течение 30 секунд. Конфиг плагина нужно будет обновить."
                    >
                      <LinkKeyForm action={resetLinkServerKey} apiUrl={apiUrl} submitLabel="Заменить ключ" pendingText="Меняю ключ…">
                        <input type="hidden" name="id" value={s.id} />
                      </LinkKeyForm>
                    </ModalTrigger>
                  </div>
                </div>
              );
            })}
          </div>
        </Section>
      )}
    </>
  );
}
