import { MAPS_SECRETS, prisma } from "@flamebot/core";
import { ActionForm, SubmitButton } from "@/components/ActionForm";
import { EmptyState, PageHead, Section } from "@/components/Fields";
import { MapsButton } from "@/components/MapsButton";
import { SecretField } from "@/components/SecretField";
import { requirePage } from "@/lib/auth";
import { clearMapsSecret, saveMapsSecrets } from "../actions";

export const metadata = { title: "Подключение бота карт" };

interface CheckRow {
  name: string;
  ok: boolean | null;
  text: string;
}
interface PteroServer {
  title: string;
  error: string | null;
  tasks: { run: string; blueprints: boolean; map: string }[];
}

const when = (d: Date) => d.toLocaleString("ru-RU", { dateStyle: "short", timeStyle: "short" });

// Ключи и токены бота карт. Шифруются ключом бота при сохранении: панель и база их прочитать не могут.
export default async function MapsConnectionPage() {
  await requirePage("full");
  const [secrets, key, lastCheck, lastPtero] = await Promise.all([
    prisma.mapsSecret.findMany(),
    prisma.botPublicKey.findUnique({ where: { botKey: "maps" } }),
    prisma.mapsAction.findFirst({ where: { kind: "check", status: { in: ["done", "error"] } }, orderBy: { id: "desc" } }),
    prisma.mapsAction.findFirst({ where: { kind: "ptero.status", status: { in: ["done", "error"] } }, orderBy: { id: "desc" } }),
  ]);
  const byName = new Map(secrets.map((s) => [s.name, s]));
  const checkRows = (lastCheck?.details ?? []) as unknown as CheckRow[];
  const ptero = (lastPtero?.details ?? []) as unknown as PteroServer[];

  return (
    <>
      <PageHead title="Подключение" hint="Ключи и токены бота карт. Они шифруются ключом бота сразу при сохранении: посмотреть их нельзя, только заменить." />

      {!key && <p className="notice warn">Бот карт ещё ни разу не запускался, поэтому ключа шифрования нет. Запусти сервис maps-bot, и здесь можно будет сохранить секреты.</p>}

      <ActionForm action={saveMapsSecrets}>
        <Section title="Ключи и токены" hint="Пустое поле — оставить прежнее значение. Токен Telegram необязателен: без него бот работает только через панель.">
          <div className="setting" style={{ flexDirection: "column", alignItems: "stretch", gap: 14 }}>
            {MAPS_SECRETS.map((m) => {
              const saved = byName.get(m.name);
              return (
                <div key={m.name}>
                  <SecretField name={m.name} label={`${m.label}${m.required ? "" : " (необязательно)"}`} placeholder={m.placeholder} saved={!!saved} savedAt={saved ? `${when(saved.setAt)}, ${saved.setByName ?? "?"}` : null} />
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
        <Section title="Удалить ключ" hint="Например, чтобы отключить Telegram или Pterodactyl.">
          <div className="row-actions" style={{ flexWrap: "wrap" }}>
            {MAPS_SECRETS.filter((m) => byName.has(m.name)).map((m) => (
              <ActionForm key={m.name} action={clearMapsSecret} confirm={`Удалить «${m.label}»?`} confirmLabel="Удалить" danger>
                <input type="hidden" name="name" value={m.name} />
                <SubmitButton variant="danger">{m.label}</SubmitButton>
              </ActionForm>
            ))}
          </div>
        </Section>
      )}

      <Section
        title="Проверка подключений"
        hint="Бот проверит расписание, ключ и конфиги RustMaps, запись в S3 и ссылку CDN, вебхук Discord (без сообщения), Telegram и доступ к серверам Pterodactyl. Ничего не генерирует."
        action={<MapsButton kind="check" args={{}} variant="primary">Проверить</MapsButton>}
      >
        {!lastCheck ? (
          <EmptyState icon="activity" title="Проверок ещё не было" />
        ) : (
          <>
            <p className="muted" style={{ fontSize: 12.5 }}>Последняя проверка: {when(lastCheck.createdAt)}, {lastCheck.byName}</p>
            <div className="card" style={{ padding: "8px 8px 4px" }}>
              <table className="table">
                <tbody>
                  {checkRows.map((r, i) => (
                    <tr key={i}>
                      <td style={{ width: 140 }}>
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

      <Section title="Задачи вайпа в Pterodactyl" hint="Что сейчас записано в задачах вайпа серверов: когда ближайший запуск, какая карта и сбрасываются ли рецепты." action={<MapsButton kind="ptero.status" args={{}}>Прочитать</MapsButton>}>
        {!lastPtero ? (
          <EmptyState icon="server" title="Ещё не читали" />
        ) : lastPtero.status === "error" ? (
          <p className="notice warn">{lastPtero.result}</p>
        ) : (
          <>
            <p className="muted" style={{ fontSize: 12.5 }}>Прочитано: {when(lastPtero.createdAt)}</p>
            <div className="tiles">
              {ptero.map((srv) => (
                <div key={srv.title} className="setting" style={{ alignItems: "flex-start" }}>
                  <div className="setting-body">
                    <div className="setting-title">{srv.title}</div>
                    <div className="setting-hint">
                      {srv.error
                        ? `Ошибка: ${srv.error}`
                        : srv.tasks.length === 0
                          ? "Задач вайпа нет"
                          : srv.tasks.map((t, i) => (
                              <div key={i}>
                                {t.run} · {t.blueprints ? "🧹 рецепты сбрасываются" : "рецепты сохраняются"} · <code>{t.map}</code>
                              </div>
                            ))}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </Section>
    </>
  );
}
