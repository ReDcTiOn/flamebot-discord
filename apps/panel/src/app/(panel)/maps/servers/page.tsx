import { Plus } from "lucide-react";
import { prisma, type MapsServer } from "@flamebot/core";
import { ActionForm, SubmitButton } from "@/components/ActionForm";
import { EmptyState, PageHead } from "@/components/Fields";
import { ModalCancel, ModalTrigger } from "@/components/ui/Modal";
import { requirePage } from "@/lib/auth";
import { deleteMapsServer, saveMapsServer } from "../actions";

export const metadata = { title: "Серверы карт" };

function ServerFields({ s }: { s?: MapsServer }) {
  return (
    <div className="form-grid">
      {s && <input type="hidden" name="originalId" value={s.id} />}
      <div className="grid" style={{ gridTemplateColumns: "120px 1fr" }}>
        <label className="stack">
          <span>Номер</span>
          <input type="number" name="id" defaultValue={s?.id} required min={1} max={99} className="wide" placeholder="1" />
        </label>
        <label className="stack">
          <span>Название</span>
          <input type="text" name="title" defaultValue={s?.title} required maxLength={60} className="wide" placeholder="FR #1 [NOLIMIT | X3]" />
        </label>
      </div>
      <div className="grid grid-2">
        <label className="stack">
          <span>Размер карты</span>
          <input type="number" name="size" defaultValue={s?.size ?? 4000} required min={1000} max={6000} step={50} className="wide" />
        </label>
        <label className="stack">
          <span>Сохранённый конфиг RustMaps</span>
          <input type="text" name="savedConfig" defaultValue={s?.savedConfig} required maxLength={60} className="wide" placeholder="4000_Modded" />
        </label>
      </div>
      <label className="stack">
        <span>Папка в S3</span>
        <input type="text" name="folder" defaultValue={s?.folder} required maxLength={60} className="wide" placeholder="1_nolimit" />
      </label>
      <label className="stack">
        <span>Сервер в Pterodactyl (необязательно)</span>
        <input type="text" name="pteroUuid" defaultValue={s?.pteroUuid ?? ""} maxLength={36} className="wide" placeholder="идентификатор из адреса /server/<id>" />
      </label>
      <p className="muted" style={{ fontSize: 12.5 }}>
        Серверы с одним конфигом делят пул карт: «Заменить» берёт из него готовую карту. Номер сервера используется в расписании и в шаблонах анонса как {"{view:N}"} и {"{download:N}"}.
      </p>
    </div>
  );
}

export default async function MapsServersPage() {
  await requirePage();
  const [servers, rules] = await Promise.all([prisma.mapsServer.findMany({ orderBy: { id: "asc" } }), prisma.mapsWipeRule.findMany({ select: { key: true, serverIds: true } })]);

  return (
    <>
      <PageHead title="Серверы" hint="Игровые серверы, для которых бот подбирает карты: размер, конфиг RustMaps, папка в S3 и сервер в Pterodactyl.">
        <ModalTrigger
          label={
            <>
              <Plus size={16} aria-hidden="true" /> Добавить сервер
            </>
          }
          buttonClass="btn primary"
          title="Новый сервер"
        >
          <ActionForm action={saveMapsServer} resetOnSuccess>
            <ServerFields />
            <div className="modal-actions">
              <ModalCancel />
              <SubmitButton>Добавить</SubmitButton>
            </div>
          </ActionForm>
        </ModalTrigger>
      </PageHead>

      {servers.length === 0 ? (
        <EmptyState icon="server" title="Серверов нет" hint="Добавь серверы, затем укажи их в расписании." />
      ) : (
        <div className="card" style={{ padding: "8px 8px 4px" }}>
          <table className="table">
            <thead>
              <tr>
                <th>Сервер</th>
                <th>Карта</th>
                <th>Папка в S3</th>
                <th>Pterodactyl</th>
                <th>В расписании</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {servers.map((s) => {
                const used = rules.filter((r) => r.serverIds.includes(s.id)).map((r) => r.key);
                return (
                  <tr key={s.id}>
                    <td>
                      <b>#{s.id}</b> {s.title}
                    </td>
                    <td className="secondary">
                      {s.size} · <code>{s.savedConfig}</code>
                    </td>
                    <td className="secondary">
                      <code>{s.folder}</code>
                    </td>
                    <td className="secondary">{s.pteroUuid ? <code>{s.pteroUuid}</code> : "—"}</td>
                    <td className="secondary">{used.join(", ") || "нет"}</td>
                    <td style={{ width: 1 }}>
                      <div className="row-actions">
                        <ModalTrigger label="Изменить" buttonClass="btn small" title={s.title}>
                          <ActionForm action={saveMapsServer}>
                            <ServerFields s={s} />
                            <div className="modal-actions">
                              <ModalCancel />
                              <SubmitButton>Сохранить</SubmitButton>
                            </div>
                          </ActionForm>
                        </ModalTrigger>
                        <ActionForm action={deleteMapsServer} confirm={`Удалить сервер «${s.title}»?`} confirmMessage="История карт этого сервера останется." confirmLabel="Удалить" danger>
                          <input type="hidden" name="id" value={s.id} />
                          <SubmitButton variant="danger">Удалить</SubmitButton>
                        </ActionForm>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
