import { NOTICE_SECRETS, prisma } from "@flamebot/core";
import { ActionForm, SubmitButton } from "@/components/ActionForm";
import { EmptyState, PageHead, Section } from "@/components/Fields";
import { NoticeButton } from "@/components/NoticeButton";
import { SecretField } from "@/components/SecretField";
import { requirePage } from "@/lib/auth";
import { clearNoticeSecret, saveNoticeSecrets } from "../actions";

export const metadata = { title: "Подключение бота объявлений" };

interface CheckRow {
  name: string;
  ok: boolean | null;
  text: string;
}
interface StorePromo {
  code: string;
  type?: string;
  amount?: number;
  dateEnd?: string;
  used?: number;
}

const when = (d: Date) => d.toLocaleString("ru-RU", { dateStyle: "short", timeStyle: "short" });

// Ключи и токены бота объявлений. Шифруются ключом бота при сохранении: панель и база их прочитать не могут.
export default async function NoticeConnectionPage() {
  await requirePage("full");
  const [secrets, key, lastCheck, lastPromos] = await Promise.all([
    prisma.noticeSecret.findMany(),
    prisma.botPublicKey.findUnique({ where: { botKey: "notices" } }),
    prisma.noticeAction.findFirst({ where: { kind: "check", status: { in: ["done", "error"] } }, orderBy: { id: "desc" } }),
    prisma.noticeAction.findFirst({ where: { kind: "promos.list", status: { in: ["done", "error"] } }, orderBy: { id: "desc" } }),
  ]);
  const byName = new Map(secrets.map((s) => [s.name, s]));
  const checkRows = (lastCheck?.details ?? []) as unknown as CheckRow[];
  const promos = (lastPromos?.details ?? []) as unknown as StorePromo[];

  return (
    <>
      <PageHead title="Подключение" hint="Токены и ключи бота объявлений. Они шифруются ключом бота сразу при сохранении: посмотреть их нельзя, только заменить." />

      {!key && <p className="notice warn">Бот объявлений ещё ни разу не запускался, поэтому ключа шифрования нет. Запусти сервис notice-bot, и здесь можно будет сохранить ключи.</p>}

      <ActionForm action={saveNoticeSecrets}>
        <Section title="Ключи и токены" hint="Пустое поле — оставить прежнее значение. Telegram-бот нужен отдельный: тот, что у бота карт или уведомлений онлайна, не подойдёт — они будут отбирать друг у друга нажатия кнопок.">
          <div className="setting" style={{ flexDirection: "column", alignItems: "stretch", gap: 14 }}>
            {NOTICE_SECRETS.map((m) => {
              const saved = byName.get(m.name);
              return (
                <div key={m.name}>
                  <SecretField
                    key={saved?.setAt.toISOString() ?? "none"}
                    name={m.name}
                    label={`${m.label}${m.required ? "" : " (необязательно)"}`}
                    placeholder={m.placeholder}
                    saved={!!saved}
                    savedAt={saved ? `${when(saved.setAt)}, ${saved.setByName ?? "?"}` : null}
                  />
                  {saved?.hint && <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>Сохранено: {saved.hint}</div>}
                </div>
              );
            })}
          </div>
        </Section>
        <div className="save-bar">
          <SubmitButton>Сохранить</SubmitButton>
        </div>
      </ActionForm>

      {secrets.length > 0 && (
        <Section title="Удалить ключ" hint="Например, чтобы отключить тестовые площадки.">
          <div className="row-actions" style={{ flexWrap: "wrap" }}>
            {NOTICE_SECRETS.filter((m) => byName.has(m.name)).map((m) => (
              <ActionForm key={m.name} action={clearNoticeSecret} confirm={`Удалить «${m.label}»?`} confirmLabel="Удалить" danger>
                <input type="hidden" name="name" value={m.name} />
                <SubmitButton variant="danger">{m.label}</SubmitButton>
              </ActionForm>
            ))}
          </div>
        </Section>
      )}

      <Section
        title="Проверка подключений"
        hint="Бот проверит Telegram, вебхуки Discord (без сообщения), ключ ВКонтакте, ключи gamestores, картинки и расписание. Ничего не публикует."
        action={
          <NoticeButton kind="check" args={{}} variant="primary">
            Проверить
          </NoticeButton>
        }
      >
        {!lastCheck ? (
          <EmptyState icon="activity" title="Проверок ещё не было" />
        ) : lastCheck.status === "error" && !checkRows.length ? (
          <p className="notice warn">{lastCheck.result}</p>
        ) : (
          <>
            <p className="muted" style={{ fontSize: 12.5 }}>
              Последняя проверка: {when(lastCheck.createdAt)}, {lastCheck.byName}
            </p>
            <div className="card" style={{ padding: "8px 8px 4px" }}>
              <table className="table">
                <tbody>
                  {checkRows.map((r, i) => (
                    <tr key={i}>
                      <td style={{ width: 160 }}>
                        <span className={r.ok === true ? "chip success" : r.ok === false ? "chip danger" : "chip"}>{r.name}</span>
                      </td>
                      <td>{r.text}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </Section>

      <Section
        title="Промокоды gamestores"
        hint="Активные промокоды магазина. Создаёт и удаляет бот сам: при подтверждении текста и при отмене вайпа."
        action={<NoticeButton kind="promos.list" args={{}}>Обновить список</NoticeButton>}
      >
        {!lastPromos ? (
          <EmptyState icon="ticket" title="Ещё не запрашивали" />
        ) : lastPromos.status === "error" ? (
          <p className="notice warn">{lastPromos.result}</p>
        ) : promos.length === 0 ? (
          <EmptyState icon="ticket" title="Активных промокодов нет" />
        ) : (
          <>
            <p className="muted" style={{ fontSize: 12.5 }}>Получено: {when(lastPromos.createdAt)}</p>
            <div className="card" style={{ padding: "8px 8px 4px" }}>
              <table className="table">
                <thead>
                  <tr>
                    <th>Код</th>
                    <th>Что даёт</th>
                    <th>До</th>
                    <th className="num">Использован</th>
                  </tr>
                </thead>
                <tbody>
                  {promos.map((p, i) => (
                    <tr key={i}>
                      <td>
                        <code>{p.code}</code>
                      </td>
                      <td>{p.type === "discount" ? `скидка ${p.amount}%` : p.type === "money" ? `${p.amount} на баланс` : p.type === "item" ? "товар" : String(p.amount ?? "")}</td>
                      <td className="secondary">{p.dateEnd ?? "—"}</td>
                      <td className="num">{p.used ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </Section>
    </>
  );
}
