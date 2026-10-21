import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, ExternalLink } from "lucide-react";
import {
  MAPS_CYCLE_STATUS,
  MAPS_OPEN_CYCLES,
  MAPS_PANEL_STATE,
  MAPS_POOL_STATUS,
  MAPS_SLOT_STATUS,
  monumentChecklist,
  prisma,
  resolveScoring,
  scorePool,
  type MapInfo,
  type MapScore,
} from "@flamebot/core";
import { ActionForm, SubmitButton } from "@/components/ActionForm";
import { AutoRefresh } from "@/components/AutoRefresh";
import { EmptyState, Section } from "@/components/Fields";
import { MapsButton } from "@/components/MapsButton";
import { ModalCancel, ModalTrigger } from "@/components/ui/Modal";
import { requirePage } from "@/lib/auth";
import { CYCLE_CHIP, MAPS_ACTION_LABEL, SLOT_CHIP, fileName, mapsView } from "@/lib/maps";
import { mapsAction } from "../../actions";

export const metadata = { title: "Вайп" };

const g = (n: number) => String(Math.round(n * 10) / 10);

export default async function MapsCyclePage({ params }: { params: Promise<{ id: string }> }) {
  await requirePage();
  const id = decodeURIComponent((await params).id);
  if (!/^[a-z0-9_-]{1,40}$/.test(id)) notFound();
  const { s, fmt } = await mapsView();
  const cycle = await prisma.mapsCycle.findUnique({
    where: { id },
    include: { slots: { orderBy: { serverId: "asc" } }, candidates: { orderBy: { id: "asc" } } },
  });
  if (!cycle) notFound();
  const [servers, actions] = await Promise.all([
    prisma.mapsServer.findMany(),
    prisma.mapsAction.findMany({
      where: {
        OR: [
          { args: { path: ["cycleId"], equals: id } },
          { args: { path: ["wipeId"], equals: id } },
          ...cycle.slots.map((sl) => ({ args: { path: ["slotId"], equals: sl.id } })),
        ],
      },
      orderBy: { id: "desc" },
      take: 10,
    }),
  ]);
  const titles = new Map(servers.map((x) => [x.id, x.title]));
  const title = (sid: number) => titles.get(sid) ?? `FR #${sid}`;
  const open = (MAPS_OPEN_CYCLES as readonly string[]).includes(cycle.status);
  const future = cycle.wipeAt > new Date();
  const pteroOn = !!s.pteroUrl && cycle.slots.some((sl) => servers.find((x) => x.id === sl.serverId)?.pteroUuid);

  // Оценки считаются так же, как в боте: внутри группы (размер + конфиг) по всем картам с данными.
  const scoring = resolveScoring(s.scoring);
  const scores = new Map<number, MapScore>();
  const groups = new Map<string, typeof cycle.candidates>();
  for (const c of cycle.candidates) {
    if (c.info === null || !["ready", "assigned", "rejected"].includes(c.status)) continue;
    const k = `${c.size}:${c.config}`;
    groups.set(k, [...(groups.get(k) ?? []), c]);
  }
  for (const list of groups.values()) {
    const res = scorePool(list.map((c) => c.info as MapInfo), list[0]!.size, scoring);
    list.forEach((c, i) => scores.set(c.id, res[i]!));
  }
  const pool = new Map<string, Map<string, number>>();
  for (const c of cycle.candidates) {
    const bySize = pool.get(`${c.size} · ${c.config}`) ?? new Map<string, number>();
    bySize.set(c.status, (bySize.get(c.status) ?? 0) + 1);
    pool.set(`${c.size} · ${c.config}`, bySize);
  }
  const lastRejected = (slotId: number) =>
    cycle.candidates.filter((c) => c.slotId === slotId && c.status === "rejected" && c.rejectedOrder !== null).sort((a, b) => b.rejectedOrder! - a.rejectedOrder!)[0];
  const uploaded = cycle.slots.filter((x) => x.status === "uploaded").length;
  const busy = cycle.slots.some((x) => x.status === "uploading" || x.status === "waiting") || actions.some((a) => a.status === "pending" || a.status === "running");

  return (
    <>
      <Link href="/maps/cycles" className="back-link">
        <ArrowLeft size={15} aria-hidden="true" /> Все вайпы
      </Link>

      <div className="member-head">
        <div style={{ minWidth: 0, flex: 1 }}>
          <h1>Вайп {fmt(cycle.wipeAt)}</h1>
          <div className="secondary" style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginTop: 4 }}>
            <span className={CYCLE_CHIP[cycle.status] ?? "chip"}>{MAPS_CYCLE_STATUS[cycle.status] ?? cycle.status}</span>
            {cycle.staging && <span className="chip">🧪 staging</span>}
            {cycle.blueprints && <span className="chip warn">🧹 глобальный</span>}
            {cycle.autoMode && <span className="chip accent">🤖 автоподбор</span>}
            <span className="muted">{cycle.id}</span>
          </div>
        </div>
        {(open || busy) && (
          <div className="row-actions">
            <AutoRefresh seconds={5} />
          </div>
        )}
      </div>

      <div className="grid grid-4" style={{ marginBottom: 10 }}>
        <div className="metric"><div className="metric-label">Карт подтверждено</div><div className="metric-value">{uploaded} / {cycle.slots.length}</div></div>
        <div className="metric"><div className="metric-label">Анонс в Discord</div><div className="metric-value" style={{ fontSize: 16 }}>{fmt(cycle.sendAt)}</div></div>
        <div className="metric"><div className="metric-label">Карт в пуле</div><div className="metric-value">{cycle.candidates.length}</div></div>
        <div className="metric"><div className="metric-label">Pterodactyl</div><div className="metric-value" style={{ fontSize: 16 }}>{pteroOn ? (MAPS_PANEL_STATE[cycle.panelState] ?? cycle.panelState) : "не настроен"}</div></div>
      </div>
      {pool.size > 0 && (
        <div className="facts">
          {[...pool].map(([k, st]) => (
            <span key={k}>
              Пул {k}: <b>{[...st].map(([status, n]) => `${MAPS_POOL_STATUS[status] ?? status} ${n}`).join(", ")}</b>
            </span>
          ))}
        </div>
      )}

      {open && (
        <Section
          title="Автоподбор"
          hint={cycle.autoMode ? "Бот выбрал лучшие карты из пула по оценке. Подтверди набор целиком или выбери карты по серверам." : "Бот сам выберет лучшие карты из пула и предложит набор целиком."}
          action={
            cycle.autoMode ? undefined : (
              <MapsButton kind="auto.start" args={{ cycleId: cycle.id }} confirm="Подобрать карты автоматически?" confirmMessage="Неподтверждённые карты заменятся лучшими из пула. Подтверждённые останутся.">
                Подобрать автоматически
              </MapsButton>
            )
          }
        >
          {cycle.autoMode && (
            <div className="row-actions" style={{ flexWrap: "wrap" }}>
              <MapsButton kind="auto.confirm" args={{ cycleId: cycle.id }} variant="primary">Подтвердить все</MapsButton>
              <MapsButton kind="auto.reroll" args={{ cycleId: cycle.id }} confirm="Перевыбрать автоматически?" confirmMessage="Неподтверждённые карты уйдут, возьмутся следующие лучшие. Если пул кончится, потратятся новые генерации.">
                Перевыбрать автоматически
              </MapsButton>
              <MapsButton kind="auto.manual" args={{ cycleId: cycle.id }}>Выбрать самому</MapsButton>
            </div>
          )}
        </Section>
      )}

      <Section title="Карты серверов">
        <div className="server-grid">
          {cycle.slots.map((sl) => {
            const sc = sl.candId ? scores.get(sl.candId) : undefined;
            const checklist = sl.info ? monumentChecklist((sl.info as MapInfo).monuments) : [];
            const absent = checklist.filter((r) => !r.present).map((r) => r.name);
            const prev = lastRejected(sl.id);
            return (
              <div key={sl.id} className={`server-card ${sl.status === "uploaded" ? "state-online" : sl.status === "error" ? "state-offline" : ""}`}>
                <div className="server-card-head">
                  <div style={{ minWidth: 0 }}>
                    <div className="setting-title">{title(sl.serverId)}</div>
                    <div className="muted" style={{ fontSize: 12 }}>
                      {sl.source === "manual" ? "своя карта" : sl.seed !== null ? `seed ${sl.seed}` : "—"} · {sl.size} · {sl.config}
                      {sl.attempt > 1 ? ` · попытка ${sl.attempt}` : ""}
                    </div>
                  </div>
                  <span className={SLOT_CHIP[sl.status] ?? "chip"}>{MAPS_SLOT_STATUS[sl.status] ?? sl.status}</span>
                </div>

                {sc && (
                  <div style={{ fontSize: 13 }}>
                    Оценка <b>{g(sc.total)}</b>/100 <span className="muted">· РТ {g(sc.rt)} · расстановка {g(sc.spread)} · рельеф {g(sc.terrain)} · насыщенность {g(sc.extra)}</span>
                  </div>
                )}
                {checklist.length > 0 && (
                  <div style={{ fontSize: 13 }}>
                    РТ: <b>{checklist.length - absent.length} из {checklist.length}</b>
                    {absent.length ? <span className="muted"> · нет: {absent.join(", ")}</span> : " ✅"}
                  </div>
                )}
                {sl.status === "uploaded" && sl.cdnUrl && (
                  <div style={{ fontSize: 13, wordBreak: "break-all" }}>
                    <code>{fileName(sl.cdnUrl)}</code>
                  </div>
                )}
                <div className="server-meta">
                  {sl.viewUrl && (
                    <a href={sl.viewUrl} target="_blank" rel="noreferrer" className="link">
                      <ExternalLink size={12} aria-hidden="true" /> {sl.source === "manual" ? "Страница карты" : "RustMaps"}
                    </a>
                  )}
                  {sl.cdnUrl && (
                    <a href={sl.cdnUrl} target="_blank" rel="noreferrer" className="link">
                      Скачать
                    </a>
                  )}
                </div>
                {sl.panelNote && <div className="muted" style={{ fontSize: 12 }}>Pterodactyl: {sl.panelSynced ? "✅" : "⚠️"} {sl.panelNote}</div>}
                {sl.error && <div className="server-error">{sl.error}</div>}

                {open && (
                  <div className="row-actions" style={{ flexWrap: "wrap" }}>
                    {sl.status === "ready" && (
                      <>
                        <MapsButton kind="slot.approve" args={{ slotId: sl.id }} variant="primary">Подтвердить</MapsButton>
                        <MapsButton kind="slot.reroll" args={{ slotId: sl.id }}>Заменить</MapsButton>
                        {prev && <MapsButton kind="slot.back" args={{ slotId: sl.id }}>Назад ({prev.seed})</MapsButton>}
                      </>
                    )}
                    {sl.status === "error" && <MapsButton kind="slot.reroll" args={{ slotId: sl.id }}>Сгенерировать заново</MapsButton>}
                    {sl.status !== "uploading" && (
                      <ModalTrigger label="Своя карта" buttonClass="btn" title={`Своя карта: ${title(sl.serverId)}`} description="Бот скачает файл по ссылке, загрузит в S3 и подставит вместо карты сервера.">
                        <ActionForm action={mapsAction}>
                          <input type="hidden" name="kind" value="slot.manual" />
                          <input type="hidden" name="slotId" value={sl.id} />
                          <label className="stack">
                            <span>Прямая ссылка на файл .map</span>
                            <input type="url" name="url" required className="wide" placeholder="https://…/proceduralmap.4000.12345.map" />
                          </label>
                          <label className="stack" style={{ marginTop: 12 }}>
                            <span>Страница карты для кнопки «Посмотреть» (необязательно)</span>
                            <input type="url" name="viewUrl" className="wide" placeholder="https://rustmaps.com/map/…" />
                          </label>
                          <p className="muted" style={{ fontSize: 12.5 }}>Файл до 600 МБ. Большая карта качается несколько минут: результат появится на этой странице.</p>
                          <div className="modal-actions">
                            <ModalCancel />
                            <SubmitButton>Загрузить</SubmitButton>
                          </div>
                        </ActionForm>
                      </ModalTrigger>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </Section>

      {open && (
        <Section title="Изменить карты">
          <div className="row-actions" style={{ flexWrap: "wrap" }}>
            {uploaded > 0 && (
              <MapsButton kind="cycle.unconfirm" args={{ cycleId: cycle.id }} confirm="Снять подтверждения?" confirmMessage="Те же карты вернутся к выбору, автоотправка анонса отменится. Свои загруженные карты снимутся.">
                Снять подтверждения
              </MapsButton>
            )}
            <MapsButton
              kind="cycle.replaceAll"
              args={{ cycleId: cycle.id }}
              confirm="Заменить все карты этого вайпа?"
              confirmMessage="Подтверждённые тоже заменятся, автоотправка в Discord и запись в Pterodactyl сбросятся. Если готовых карт не хватит, потратятся новые генерации."
              danger
            >
              Заменить все карты
            </MapsButton>
            {future && (
              <MapsButton kind="global.toggle" args={{ cycleId: cycle.id }} confirm={cycle.blueprints ? "Сделать вайп обычным?" : "Сделать вайп глобальным?"} confirmMessage={cycle.blueprints ? "«Wipe Blueprints» в Pterodactyl будет выключен: рецепты сохранятся." : "«Wipe Blueprints» в Pterodactyl будет включён: рецепты сбросятся."}>
                {cycle.blueprints ? "Сделать обычным" : "Сделать глобальным"}
              </MapsButton>
            )}
          </div>
        </Section>
      )}

      <Section
        title="Анонс в Discord"
        hint={
          cycle.status === "generating"
            ? `Уйдёт в ${fmt(cycle.sendAt)}, когда все карты будут подтверждены.`
            : cycle.status === "scheduled"
              ? `Все карты подтверждены, анонс уйдёт автоматически в ${fmt(cycle.sendAt)}.`
              : cycle.status === "awaiting_discord"
                ? "Автоотправка выключена или не удалась: отправь вручную."
                : cycle.status === "skipped"
                  ? "Анонс по этому вайпу отключён."
                  : cycle.status === "sent"
                    ? "Анонс отправлен."
                    : "Анонс отправляется…"
        }
      >
        <div className="row-actions" style={{ flexWrap: "wrap" }}>
          {(cycle.status === "scheduled" || cycle.status === "awaiting_discord") && (
            <>
              <MapsButton kind="discord.send" args={{ cycleId: cycle.id }} variant="primary" confirm="Отправить анонс в Discord сейчас?">Отправить сейчас</MapsButton>
              <MapsButton kind="discord.skip" args={{ cycleId: cycle.id }} confirm="Не отправлять анонс по этому вайпу?" danger>Не отправлять</MapsButton>
            </>
          )}
          {cycle.status === "skipped" && <MapsButton kind="discord.prompt" args={{ cycleId: cycle.id }}>Вернуть отправку</MapsButton>}
          {cycle.status === "sent" && (
            <MapsButton kind="discord.resend" args={{ cycleId: cycle.id }} confirm="Отправить анонс ещё раз?" confirmMessage="Предыдущее сообщение в Discord не удаляется.">
              Отправить повторно
            </MapsButton>
          )}
        </div>
      </Section>

      {pteroOn && (
        <Section
          title="Ссылки в Pterodactyl"
          hint={`Бот спрашивает за ${s.panelAskHours} ч до вайпа и записывает сам за ${s.panelAutoMinutes} мин, если ответа нет. Сейчас: ${MAPS_PANEL_STATE[cycle.panelState] ?? cycle.panelState}.`}
        >
          {future && (cycle.panelState === "idle" || cycle.panelState === "pending") ? (
            <div className="row-actions">
              <MapsButton kind="ptero.apply" args={{ cycleId: cycle.id }} variant="primary" confirm="Записать ссылки в задачи вайпа?" confirmMessage={cycle.blueprints ? "«Wipe Blueprints» будет включён (глобальный вайп)." : "«Wipe Blueprints» будет выключен."}>
                Записать ссылки
              </MapsButton>
              <MapsButton kind="ptero.skip" args={{ cycleId: cycle.id }} confirm="Не записывать ссылки? Поставишь их сам." danger>
                Сделаю сам
              </MapsButton>
            </div>
          ) : (
            <p className="muted" style={{ fontSize: 13 }}>{future ? "Ссылки записаны или запись отключена. Если карты поменяются, бот спросит снова." : "Вайп уже прошёл."}</p>
          )}
        </Section>
      )}

      <Section title="Действия из панели" hint="Что просили сделать с этим вайпом из панели и что ответил бот. Действия из Telegram — в «Истории».">
        {actions.length === 0 ? (
          <EmptyState icon="list" title="Пока ничего" />
        ) : (
          <div className="card" style={{ padding: "8px 8px 4px" }}>
            <table className="table">
              <tbody>
                {actions.map((a) => (
                  <tr key={a.id}>
                    <td className="secondary" style={{ whiteSpace: "nowrap", width: 1 }}>{a.createdAt.toLocaleString("ru-RU")}</td>
                    <td>
                      {MAPS_ACTION_LABEL[a.kind] ?? a.kind}
                      <div className="muted" style={{ fontSize: 12 }}>{a.byName}</div>
                    </td>
                    <td>
                      <span className={a.status === "done" ? "chip success" : a.status === "error" ? "chip warn" : "chip"}>
                        {a.status === "pending" ? "ждёт бота" : a.status === "running" ? "выполняется" : a.status === "done" ? "готово" : "не выполнено"}
                      </span>{" "}
                      {a.result}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>
    </>
  );
}
