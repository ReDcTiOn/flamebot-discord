import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { formatNumber, prisma, rankProgress, SNOWFLAKE } from "@flamebot/core";
import { ActionForm, SubmitButton } from "@/components/ActionForm";
import { EventTable, eventGroup, type TimelineRow } from "@/components/EventTable";
import { DangerZone, EmptyState, Section, Tabs, pickTab } from "@/components/Fields";
import { ModalCancel, ModalTrigger } from "@/components/ui/Modal";
import { requirePage } from "@/lib/auth";
import { avatarUrl } from "@/lib/discord";
import { adjustMember, endPurchase, giveBadge, removeBadge, resetMember } from "../../actions";

export const metadata = { title: "Игрок" };

const TAB_KEYS = ["overview", "purchases", "rep", "history"] as const;
const REQUEST_LABEL = { PENDING: "Заявка ждёт решения", APPROVED: "Одобрена", REJECTED: "Отклонена", EXPIRED: "Заявка истекла" } as const;
const AUDIT_LABEL: Record<string, string> = {
  "member.adjust": "Изменили баланс",
  "member.reset": "Обнулили игрока",
  "member.badge.add": "Выдали бейдж",
  "member.badge.remove": "Сняли бейдж",
  "purchase.end": "Досрочно завершили покупку",
  "customrole.approve": "Одобрили личную роль",
  "customrole.reject": "Отклонили личную роль",
  "customrole.expire": "Заявка на личную роль истекла",
};

const date = (d: Date | null | undefined) => (d ? d.toLocaleString("ru-RU") : "—");
const hex = (c: number | null) => (c === null ? undefined : `#${c.toString(16).padStart(6, "0")}`);

function auditMessage(action: string, details: unknown): string {
  const d = (details ?? {}) as Record<string, unknown>;
  const base = AUDIT_LABEL[action] ?? action;
  if (action === "member.adjust") {
    const field = { xp: "опыт", scrap: "скрап", rep: "репутация" }[String(d.field)] ?? String(d.field);
    const delta = Number(d.delta);
    return `${base}: ${field} ${delta > 0 ? "+" : ""}${formatNumber(delta)}${d.reason ? ` · ${d.reason}` : ""}`;
  }
  if (action === "member.badge.add" || action === "member.badge.remove") return `${base} «${d.label}»`;
  if (d.reason) return `${base} · ${d.reason}`;
  return base;
}

export default async function MemberPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ tab?: string }> }) {
  await requirePage();
  const { id } = await params;
  if (!SNOWFLAKE.test(id)) notFound();
  const tab = pickTab((await searchParams).tab, TAB_KEYS);

  const [m, ranks] = await Promise.all([
    prisma.member.findUnique({
      where: { id },
      include: {
        rank: true,
        badges: { orderBy: { createdAt: "asc" } },
        purchases: { orderBy: { createdAt: "desc" }, include: { item: true, request: true } },
        _count: { select: { repGiven: true, repReceived: true } },
      },
    }),
    prisma.rank.findMany({ orderBy: { minXp: "asc" } }),
  ]);
  if (!m) notFound();

  const place = (await prisma.member.count({ where: { inGuild: true, xp: { gt: m.xp } } })) + 1;
  const { next, ratio } = rankProgress(ranks, m.xp);
  const active = m.purchases.filter((p) => p.active);
  const pending = m.purchases.filter((p) => p.request?.status === "PENDING");
  const base = `/rating/members/${id}`;

  const [repReceived, repGiven, events, audits] = await Promise.all([
    tab === "rep" ? prisma.repTransaction.findMany({ where: { receiverId: id }, orderBy: { createdAt: "desc" }, take: 30, include: { giver: true } }) : [],
    tab === "rep" ? prisma.repTransaction.findMany({ where: { giverId: id }, orderBy: { createdAt: "desc" }, take: 30, include: { receiver: true } }) : [],
    tab === "history"
      ? prisma.botEvent.findMany({
          where: { botKey: "rating", OR: [{ memberId: id }, { details: { path: ["giverId"], equals: id } }] },
          orderBy: { createdAt: "desc" },
          take: 100,
        })
      : [],
    tab === "history"
      ? prisma.auditLog.findMany({
          where: { module: "rating", OR: [{ details: { path: ["memberId"], equals: id } }, { target: { contains: id } }] },
          orderBy: { createdAt: "desc" },
          take: 100,
        })
      : [],
  ]);

  const timeline: TimelineRow[] = [
    ...events.map((e) => ({
      key: `e${e.id}`,
      at: e.createdAt,
      level: e.level,
      group: eventGroup(e.type),
      message: e.message,
      memberId: e.memberId,
      details: e.details,
      source: "bot" as const,
    })),
    // Решения по заявкам уже есть в событиях бота, из журнала панели их не дублируем.
    ...audits
      .filter((a) => !a.action.startsWith("customrole."))
      .map((a) => ({
        key: `a${a.id}`,
        at: a.createdAt,
        level: (a.action === "member.reset" ? "WARN" : "INFO") as TimelineRow["level"],
        group: "Панель",
        message: auditMessage(a.action, a.details),
        details: a.details,
        source: "panel" as const,
        actor: a.actorName,
      })),
  ].sort((a, b) => b.at.getTime() - a.at.getTime());

  return (
    <>
      <Link href="/rating/members" className="back-link">
        <ArrowLeft size={15} aria-hidden="true" /> Все игроки
      </Link>

      <div className="member-head">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img className="member-avatar" src={avatarUrl(m.id, m.avatarHash, 128)} alt="" width={64} height={64} />
        <div style={{ minWidth: 0, flex: 1 }}>
          <h1>{m.displayName}</h1>
          <div className="secondary" style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginTop: 4 }}>
            <span>@{m.username}</span>
            <span className="muted">· {m.id}</span>
            {m.rank && <span className="chip">{m.rank.emoji} {m.rank.name}</span>}
            {!m.inGuild && <span className="chip danger">Вышел с сервера</span>}
            {pending.length > 0 && <span className="chip accent">Заявка на проверке</span>}
          </div>
        </div>
        <div className="row-actions">
          <ModalTrigger label="Изменить баланс" buttonClass="btn primary" title="Изменить баланс" description={m.displayName}>
            <ActionForm action={adjustMember}>
              <input type="hidden" name="memberId" value={m.id} />
              <div className="grid grid-2">
                <label className="stack">
                  <span>Что меняем</span>
                  <select name="field" defaultValue="scrap" className="wide">
                    <option value="scrap">Скрап</option>
                    <option value="xp">Опыт</option>
                    <option value="rep">Репутация</option>
                  </select>
                </label>
                <label className="stack">
                  <span>Изменение</span>
                  <input type="number" name="delta" placeholder="250, -100 или 0.5" step={0.01} inputMode="decimal" required className="wide" />
                </label>
              </div>
              <label className="stack" style={{ marginTop: 12 }}>
                <span>Причина (попадёт в историю)</span>
                <input type="text" name="reason" required minLength={3} maxLength={200} className="wide" placeholder="Победа в ивенте" />
              </label>
              <div className="modal-actions">
                <ModalCancel />
                <SubmitButton>Применить</SubmitButton>
              </div>
            </ActionForm>
          </ModalTrigger>
          <ModalTrigger label="Выдать бейдж" title="Выдать бейдж" description="Бейдж появится в /profile и на карточке игрока.">
            <ActionForm action={giveBadge}>
              <input type="hidden" name="memberId" value={m.id} />
              <label className="stack">
                <span>Текст бейджа</span>
                <input type="text" name="label" required maxLength={40} className="wide" placeholder="Победитель ивента" />
              </label>
              <div className="modal-actions">
                <ModalCancel />
                <SubmitButton>Выдать</SubmitButton>
              </div>
            </ActionForm>
          </ModalTrigger>
        </div>
      </div>

      <div className="grid grid-4" style={{ marginBottom: 10 }}>
        <div className="metric">
          <div className="metric-label">Опыт</div>
          <div className="metric-value">{formatNumber(m.xp)}</div>
          <div className="mini-progress" title={`${Math.round(ratio * 100)}%`}>
            <div style={{ width: `${Math.round(ratio * 100)}%` }} />
          </div>
          <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>{next ? `до «${next.name}»: ${formatNumber(next.minXp - m.xp)}` : "максимальный ранг"}</div>
        </div>
        <div className="metric"><div className="metric-label">Скрап</div><div className="metric-value">{formatNumber(m.scrap)}</div></div>
        <div className="metric"><div className="metric-label">Репутация</div><div className="metric-value">{formatNumber(m.rep)}</div><div className="muted" style={{ fontSize: 12, marginTop: 4 }}>сам дал {formatNumber(m._count.repGiven)}</div></div>
        <div className="metric"><div className="metric-label">Место в топе</div><div className="metric-value">#{formatNumber(place)}</div></div>
      </div>
      <div className="facts">
        <span>Сообщений засчитано: <b>{formatNumber(m.messageCount)}</b></span>
        <span>Последний опыт: <b>{date(m.lastXpAt)}</b></span>
        <span>В рейтинге с: <b>{m.createdAt.toLocaleDateString("ru-RU")}</b></span>
        <span>Покупок: <b>{m.purchases.length}</b></span>
      </div>

      <Tabs
        tabs={[
          { key: "overview", label: "Обзор" },
          { key: "purchases", label: `Покупки · ${m.purchases.length}` },
          { key: "rep", label: "Репутация" },
          { key: "history", label: "История" },
        ]}
        active={tab}
        base={base}
      />

      {tab === "overview" && (
        <>
          <Section title="Действующие покупки" hint="Роли из магазина, которые сейчас есть у игрока.">
            {active.length === 0 && pending.length === 0 ? (
              <p className="muted" style={{ fontSize: 13 }}>Ничего не куплено или сроки закончились.</p>
            ) : (
              <div className="tiles">
                {[...pending, ...active].map((p) => (
                  <div key={p.id} className="setting">
                    <div className="setting-icon">
                      <span className="dot" style={{ background: hex(p.request?.color ?? null) ?? "var(--text-secondary)", width: 14, height: 14, boxShadow: "0 0 0 2px var(--border-strong)" }} />
                    </div>
                    <div className="setting-body">
                      <div className="setting-title">
                        {p.item.name}
                        {p.customName && <span className="secondary"> · {p.customName}</span>}
                      </div>
                      <div className="setting-hint">
                        {p.request?.status === "PENDING" ? "Заявка ждёт решения в Discord" : p.expiresAt ? `до ${date(p.expiresAt)}` : "навсегда"} · куплено {date(p.createdAt)} за {formatNumber(p.price)} скрапа
                      </div>
                    </div>
                    {p.active && (
                      <ModalTrigger label="Завершить" buttonClass="btn small danger" title="Завершить покупку досрочно?" description={`${p.item.name}${p.customName ? ` · ${p.customName}` : ""}`} size="sm">
                        <p className="secondary" style={{ fontSize: 13, marginBottom: 12 }}>Роль снимется в течение 5 минут. Скрап не возвращается.</p>
                        <ActionForm action={endPurchase}>
                          <input type="hidden" name="id" value={p.id} />
                          <label className="stack">
                            <span>Причина</span>
                            <input type="text" name="reason" required minLength={3} maxLength={200} className="wide" placeholder="Неприличное название роли" />
                          </label>
                          <div className="modal-actions">
                            <ModalCancel />
                            <SubmitButton variant="danger">Завершить</SubmitButton>
                          </div>
                        </ActionForm>
                      </ModalTrigger>
                    )}
                  </div>
                ))}
              </div>
            )}
          </Section>

          <Section title="Бейджи">
            {m.badges.length === 0 ? (
              <p className="muted" style={{ fontSize: 13 }}>Бейджей нет. Их можно купить в магазине или выдать кнопкой «Выдать бейдж».</p>
            ) : (
              <div className="chips">
                {m.badges.map((b) => (
                  <ActionForm key={b.id} action={removeBadge} confirm={`Снять бейдж «${b.label}»?`} confirmLabel="Снять" danger className="badge-form">
                    <input type="hidden" name="id" value={b.id} />
                    <span className="chip badge-chip">
                      {b.label}
                      <button type="submit" className="chip-x" aria-label={`Снять бейдж ${b.label}`} title="Снять">
                        ×
                      </button>
                    </span>
                  </ActionForm>
                ))}
              </div>
            )}
          </Section>

          <DangerZone
            title="Обнулить игрока"
            action={
              <ModalTrigger label="Обнулить" buttonClass="btn danger-solid" title={`Обнулить ${m.displayName}?`} size="sm">
                <p className="secondary" style={{ fontSize: 13, marginBottom: 12 }}>
                  Опыт, скрап, репутация и бейджи станут нулевыми, роли рангов снимутся. Отменить нельзя.
                </p>
                <ActionForm action={resetMember}>
                  <input type="hidden" name="memberId" value={m.id} />
                  <label className="stack">
                    <span>Причина</span>
                    <input type="text" name="reason" required minLength={3} maxLength={200} className="wide" placeholder="Накрутка опыта" />
                  </label>
                  <div className="modal-actions">
                    <ModalCancel />
                    <SubmitButton variant="danger-solid">Обнулить</SubmitButton>
                  </div>
                </ActionForm>
              </ModalTrigger>
            }
          >
            Опыт, скрап, репутация и бейджи станут нулевыми, роли рангов снимутся. Например, за накрутку опыта.
          </DangerZone>
        </>
      )}

      {tab === "purchases" &&
        (m.purchases.length === 0 ? (
          <EmptyState icon="store" title="Покупок нет" hint="Здесь появится всё, что игрок купил в /shop." />
        ) : (
          <div className="card" style={{ padding: "8px 8px 4px" }}>
            <table className="table">
              <thead>
                <tr>
                  <th>Товар</th>
                  <th className="num">Цена</th>
                  <th>Статус</th>
                  <th>Куплено</th>
                </tr>
              </thead>
              <tbody>
                {m.purchases.map((p) => (
                  <tr key={p.id}>
                    <td>
                      {p.item.name}
                      {p.customName && (
                        <span className="secondary">
                          {" · "}
                          {p.request?.color != null && <span className="dot" style={{ background: hex(p.request.color), marginRight: 5 }} />}
                          {p.customName}
                        </span>
                      )}
                    </td>
                    <td className="num">{formatNumber(p.price)}</td>
                    <td>
                      {p.request && p.request.status !== "APPROVED" ? (
                        <span className={p.request.status === "PENDING" ? "chip accent" : "chip danger"} title={p.request.reason ?? undefined}>
                          {REQUEST_LABEL[p.request.status]}
                        </span>
                      ) : p.active ? (
                        <span className="chip success">{p.expiresAt ? `до ${p.expiresAt.toLocaleDateString("ru-RU")}` : "Активна"}</span>
                      ) : p.item.type === "BADGE" ? (
                        <span className="chip">Бейдж выдан</span>
                      ) : (
                        <span className="chip">Завершена</span>
                      )}
                    </td>
                    <td className="secondary">{date(p.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}

      {tab === "rep" && (
        <div className="grid grid-2">
          <Section title={`Получил · ${formatNumber(m._count.repReceived)}`}>
            {repReceived.length === 0 ? (
              <p className="muted" style={{ fontSize: 13 }}>Пока никто не давал репутацию.</p>
            ) : (
              <div className="card" style={{ padding: "4px 8px" }}>
                <table className="table">
                  <tbody>
                    {repReceived.map((r) => (
                      <tr key={r.id}>
                        <td><Link href={`/rating/members/${r.giverId}`} className="link">{r.giver.displayName}</Link></td>
                        <td className="secondary" style={{ textAlign: "right" }}>{date(r.createdAt)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Section>
          <Section title={`Дал · ${formatNumber(m._count.repGiven)}`}>
            {repGiven.length === 0 ? (
              <p className="muted" style={{ fontSize: 13 }}>Сам репутацию не давал.</p>
            ) : (
              <div className="card" style={{ padding: "4px 8px" }}>
                <table className="table">
                  <tbody>
                    {repGiven.map((r) => (
                      <tr key={r.id}>
                        <td><Link href={`/rating/members/${r.receiverId}`} className="link">{r.receiver.displayName}</Link></td>
                        <td className="secondary" style={{ textAlign: "right" }}>{date(r.createdAt)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Section>
        </div>
      )}

      {tab === "history" &&
        (timeline.length === 0 ? (
          <EmptyState icon="list" title="Истории пока нет" hint="Здесь появятся ранги, покупки, репутация и действия админов с этим игроком." />
        ) : (
          <EventTable rows={timeline} memberNames={new Map()} showMember={false} />
        ))}
    </>
  );
}
