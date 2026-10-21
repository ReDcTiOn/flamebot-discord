import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, ExternalLink } from "lucide-react";
import { formatInZone, formatNumber, getGiveawaySettings, plural, prisma } from "@flamebot/core";
import { ActionForm, SubmitButton } from "@/components/ActionForm";
import { AutoRefresh } from "@/components/AutoRefresh";
import { DangerZone, EmptyState, Section } from "@/components/Fields";
import { requirePage } from "@/lib/auth";
import { env } from "@/lib/env";
import { channelNames, giveawayStatus, memberNames, relative } from "@/lib/giveaways";
import { cancelGiveaway, finishGiveawayNow } from "../actions";

export const metadata = { title: "Розыгрыш" };

const ENTRIES_SHOWN = 300;

export default async function GiveawayPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requirePage();
  const { id: raw } = await params;
  if (!/^\d{1,9}$/.test(raw)) notFound();
  const id = Number(raw);

  const [g, settings] = await Promise.all([
    prisma.giveaway.findUnique({
      where: { id },
      include: {
        promoCodes: { orderBy: { id: "asc" } },
        entries: { orderBy: { joinedAt: "asc" }, take: ENTRIES_SHOWN },
        _count: { select: { entries: true } },
      },
    }),
    getGiveawaySettings(prisma),
  ]);
  if (!g) notFound();

  const tz = settings.timezone;
  const [names, channels] = await Promise.all([
    memberNames([g.hostId, ...g.winners, ...g.entries.map((e) => e.userId), ...g.promoCodes.flatMap((p) => (p.userId ? [p.userId] : []))]),
    channelNames([g.channelId]),
  ]);
  const name = (uid: string) => names.get(uid) ?? uid;
  const person = (uid: string) =>
    names.has(uid) ? (
      <Link href={`/rating/members/${uid}`} className="link">{names.get(uid)}</Link>
    ) : (
      <span className="muted">{uid}</span>
    );
  const status = giveawayStatus(g);
  const winners = new Set(g.winners);
  // Промокоды стоят денег: сами коды видят только администраторы сервера.
  const showCodes = user.level === "full";
  const undelivered = g.promoCodes.filter((p) => p.userId && !p.dmSent).length;

  return (
    <>
      <Link href="/giveaway/list" className="back-link">
        <ArrowLeft size={15} aria-hidden="true" /> Все розыгрыши
      </Link>

      <div className="member-head">
        <div style={{ minWidth: 0, flex: 1 }}>
          <h1>#{g.id} · {g.prize}</h1>
          <div className="secondary" style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginTop: 4 }}>
            <span className={status.chip}>{status.label}</span>
            {g.boostersOnly && <span className="chip">🚀 Только бустеры</span>}
            {g.promoCodes.length > 0 && <span className="chip">🎟 Промокоды в ЛС</span>}
            <span>#{channels.get(g.channelId) ?? g.channelId}</span>
          </div>
        </div>
        {g.messageId && (
          <div className="row-actions">
            <a href={`https://discord.com/channels/${env().GUILD_ID}/${g.channelId}/${g.messageId}`} target="_blank" rel="noreferrer" className="btn">
              <ExternalLink size={15} aria-hidden="true" /> Открыть в Discord
            </a>
          </div>
        )}
        {g.needsPublish && (
          <div className="row-actions">
            <AutoRefresh seconds={5} />
          </div>
        )}
      </div>

      {g.needsPublish && (
        <p className="notice">
          Розыгрыш создан в панели. Бот отправит его в канал в течение 10 секунд после создания, если он запущен.
          {g.publishError ? ` Последняя попытка: ${g.publishError}.` : ""}
        </p>
      )}
      {!g.needsPublish && g.status === "CANCELLED" && g.publishError && (
        <p className="notice warn">Бот не смог опубликовать розыгрыш: {g.publishError}. Создай его заново.</p>
      )}

      <div className="grid grid-4" style={{ marginBottom: 10 }}>
        <div className="metric"><div className="metric-label">Участников</div><div className="metric-value">{formatNumber(g._count.entries)}</div></div>
        <div className="metric">
          <div className="metric-label">Победителей</div>
          <div className="metric-value">{g.status === "ENDED" ? `${g.winners.length} / ${g.winnersCount}` : g.winnersCount}</div>
        </div>
        <div className="metric">
          <div className="metric-label">{g.status === "ACTIVE" ? "Итоги" : g.status === "ENDED" ? "Итоги подведены" : "Должны были пройти"}</div>
          <div className="metric-value" style={{ fontSize: 18 }}>{formatInZone(g.endsAt, tz)}</div>
          <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>{settings.timezoneLabel} · {relative(g.endsAt)}</div>
        </div>
        <div className="metric">
          <div className="metric-label">Промокодов</div>
          <div className="metric-value">{g.promoCodes.length}</div>
          {undelivered > 0 && <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>{undelivered} не дошло</div>}
        </div>
      </div>
      <div className="facts">
        <span>Организатор: <b>{name(g.hostId)}</b></span>
        <span>Создан: <b>{g.createdAt.toLocaleString("ru-RU")}</b></span>
      </div>
      {g.description && <p className="card" style={{ whiteSpace: "pre-wrap" }}>{g.description}</p>}

      {g.status === "ENDED" && (
        <Section title="Победители" hint="Перевыбрать победителей можно в Discord: /розыгрыш реролл.">
          {g.winners.length === 0 ? (
            <EmptyState icon="users" title="Победителей нет" hint="Не хватило участников." />
          ) : (
            <div className="chips">
              {g.winners.map((uid) => (
                <span key={uid} className="chip success">🥇 {name(uid)}</span>
              ))}
            </div>
          )}
        </Section>
      )}

      {g.promoCodes.length > 0 && (
        <Section
          title="Промокоды"
          hint={
            undelivered > 0
              ? "Недоставленные промокоды можно отправить ещё раз в Discord: /розыгрыш промокоды."
              : "Каждый победитель получает свой промокод в личные сообщения."
          }
        >
          <div className="card" style={{ padding: "8px 8px 4px" }}>
            <table className="table">
              <thead>
                <tr>
                  <th>Промокод</th>
                  <th>Кому</th>
                  <th>Доставка</th>
                </tr>
              </thead>
              <tbody>
                {g.promoCodes.map((p) => (
                  <tr key={p.id}>
                    <td>{showCodes ? <code>{p.code}</code> : <span className="muted">скрыт</span>}</td>
                    <td>{p.userId ? person(p.userId) : <span className="muted">не выдан</span>}</td>
                    <td>
                      {!p.userId ? (
                        <span className="muted">—</span>
                      ) : p.dmSent ? (
                        <span className="chip success">В ЛС</span>
                      ) : (
                        <span className="chip warn">Не дошёл: закрыты ЛС</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {!showCodes && <p className="muted" style={{ fontSize: 12.5 }}>Сами промокоды видны только администраторам сервера.</p>}
        </Section>
      )}

      {g.status === "ACTIVE" && (
        <Section title="Управление">
          {!g.needsPublish && <DangerZone
            title="Подвести итоги сейчас"
            action={
              <ActionForm
                action={finishGiveawayNow}
                confirm={`Подвести итоги розыгрыша #${g.id} досрочно?`}
                confirmMessage={`Бот выберет ${g.winnersCount} ${plural(g.winnersCount, "победителя", "победителей", "победителей")} среди ${formatNumber(g._count.entries)} ${plural(g._count.entries, "участника", "участников", "участников")} и объявит итоги в канале.`}
                confirmLabel="Подвести итоги"
              >
                <input type="hidden" name="id" value={g.id} />
                <SubmitButton variant="secondary">Подвести итоги</SubmitButton>
              </ActionForm>
            }
          >
            Бот выберет победителей прямо сейчас, как будто время итогов уже наступило{g.promoCodes.length > 0 ? ", и разошлёт промокоды" : ""}.
          </DangerZone>}
          <DangerZone
            title="Отменить розыгрыш"
            action={
              <ActionForm action={cancelGiveaway} confirm={`Отменить розыгрыш #${g.id}?`} confirmMessage="Победители выбраны не будут, вернуть розыгрыш нельзя." confirmLabel="Отменить розыгрыш" danger>
                <input type="hidden" name="id" value={g.id} />
                <SubmitButton variant="danger">Отменить</SubmitButton>
              </ActionForm>
            }
          >
            Итоги не подводятся, кнопка «Участвовать» пропадёт, в сообщении появится «Розыгрыш отменён».
          </DangerZone>
        </Section>
      )}

      <Section
        title="Участники"
        hint={g._count.entries > ENTRIES_SHOWN ? `Показаны первые ${ENTRIES_SHOWN} из ${formatNumber(g._count.entries)}.` : "В порядке, в котором нажимали «Участвовать»."}
      >
        {g.entries.length === 0 ? (
          <EmptyState icon="users" title="Пока никто не участвует" />
        ) : (
          <div className="card" style={{ padding: "8px 8px 4px" }}>
            <table className="table">
              <thead>
                <tr>
                  <th>Участник</th>
                  <th>Когда присоединился</th>
                </tr>
              </thead>
              <tbody>
                {g.entries.map((e) => (
                  <tr key={e.userId}>
                    <td>
                      {person(e.userId)} {winners.has(e.userId) && <span className="chip success">🥇 победитель</span>}
                    </td>
                    <td className="secondary">{e.joinedAt.toLocaleString("ru-RU")}</td>
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
