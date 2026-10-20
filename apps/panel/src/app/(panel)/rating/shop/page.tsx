import { Plus } from "lucide-react";
import { formatNumber, getRatingSettings, prisma } from "@flamebot/core";
import { ActionForm, SubmitButton } from "@/components/ActionForm";
import { EmptyState, FieldRow, PageHead, Section, Switch, Tabs, pickTab } from "@/components/Fields";
import { Icon } from "@/components/Icon";
import { ShopItemFields, type RoleOption } from "@/components/ShopItemFields";
import { ModalCancel, ModalTrigger } from "@/components/ui/Modal";
import { requirePage } from "@/lib/auth";
import { listRoles, listTextChannels } from "@/lib/guild";
import { createShopItem, deleteShopItem, saveCustomRoleSettings, updateShopItem } from "../actions";

export const metadata = { title: "Магазин" };

const TAB_KEYS = ["items", "requests", "history"] as const;

const REQUEST_STATUS = {
  PENDING: { label: "Ждёт решения", chip: "chip accent" },
  APPROVED: { label: "Одобрена", chip: "chip success" },
  REJECTED: { label: "Отклонена", chip: "chip danger" },
  EXPIRED: { label: "Истекла", chip: "chip" },
} as const;

const hex = (color: number | null) => (color === null ? null : `#${color.toString(16).padStart(6, "0")}`);

const TYPE_LABEL = { ROLE: "Роль сервера", CUSTOM_ROLE: "Личная роль", BADGE: "Бейдж" } as const;
const TYPE_ICON = { ROLE: "palette", CUSTOM_ROLE: "users", BADGE: "package" } as const;

export default async function ShopPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  await requirePage();
  const tab = pickTab((await searchParams).tab, TAB_KEYS);
  const [items, rolesFull, recent, pendingCount, settings, channels, requests] = await Promise.all([
    prisma.shopItem.findMany({
      orderBy: [{ sortOrder: "asc" }, { price: "asc" }],
      include: { _count: { select: { purchases: true } } },
    }),
    listRoles(),
    tab === "history"
      ? prisma.purchase.findMany({ orderBy: { createdAt: "desc" }, take: 50, include: { item: true, member: true } })
      : Promise.resolve([]),
    prisma.customRoleRequest.count({ where: { status: "PENDING" } }),
    getRatingSettings(prisma),
    tab === "requests" ? listTextChannels() : Promise.resolve([]),
    tab === "requests"
      ? prisma.customRoleRequest.findMany({
          orderBy: [{ status: "asc" }, { createdAt: "desc" }],
          take: 50,
          include: { purchase: { include: { member: true, item: true } } },
        })
      : Promise.resolve([]),
  ]);
  const TABS = [
    { key: "items", label: "Товары" },
    { key: "requests", label: pendingCount > 0 ? `Заявки · ${pendingCount}` : "Заявки" },
    { key: "history", label: "История покупок" },
  ];
  const roles: RoleOption[] = rolesFull.map((r) => ({ id: r.id, name: r.name, safe: r.safe, reason: r.reason }));
  const roleName = new Map(rolesFull.map((r) => [r.id, r.name]));

  const addButton = (
    <ModalTrigger
      label={
        <>
          <Plus size={16} aria-hidden="true" /> Добавить товар
        </>
      }
      buttonClass="btn primary"
      title="Новый товар"
      description="Товар сразу появится в /shop, если он в продаже."
      size="lg"
    >
      <ActionForm action={createShopItem} resetOnSuccess>
        <ShopItemFields roles={roles} />
        <div className="modal-actions">
          <ModalCancel />
          <SubmitButton>Добавить товар</SubmitButton>
        </div>
      </ActionForm>
    </ModalTrigger>
  );

  return (
    <>
      <PageHead title="Магазин" hint="Что игроки покупают за скрап командой /shop. Роли с правами модерации продавать нельзя.">
        {tab === "items" && addButton}
      </PageHead>
      <Tabs tabs={TABS} active={tab} base="/rating/shop" />

      {tab === "items" &&
        (items.length === 0 ? (
          <EmptyState icon="store" title="Товаров пока нет" hint="Нажми «Добавить товар», чтобы открыть магазин." />
        ) : (
          <Section title={`Товары · ${items.length}`}>
            <div className="tiles">
              {items.map((item) => (
                <div key={item.id} className="setting">
                  <div className="setting-icon">
                    <Icon name={TYPE_ICON[item.type]} />
                  </div>
                  <div className="setting-body">
                    <div className="setting-title">{item.name}</div>
                    <div className="setting-hint">
                      {TYPE_LABEL[item.type]}
                      {item.type === "ROLE" && item.roleId ? ` · @${roleName.get(item.roleId) ?? "роль удалена"}` : ""}
                      {item.type === "BADGE" ? ` · «${item.badgeLabel}»` : item.durationDays ? ` · ${item.durationDays} д.` : " · навсегда"}
                      {item.stock !== null ? ` · осталось ${item.stock}` : ""}
                      {` · куплено ${item._count.purchases}`}
                    </div>
                  </div>
                  <div className="row-actions">
                    <span style={{ fontWeight: 600, fontVariantNumeric: "tabular-nums", marginRight: 6 }}>{formatNumber(item.price)} скрапа</span>
                    <span className={item.enabled ? "chip success" : "chip"}>{item.enabled ? "В продаже" : "Скрыт"}</span>
                    <ModalTrigger label="Изменить" buttonClass="btn small" title={item.name} description={`Товар #${item.id}`} size="lg">
                      <ActionForm action={updateShopItem}>
                        <input type="hidden" name="id" value={item.id} />
                        <ShopItemFields
                          roles={roles}
                          item={{
                            name: item.name,
                            description: item.description,
                            type: item.type,
                            price: item.price,
                            roleId: item.roleId,
                            durationDays: item.durationDays,
                            badgeLabel: item.badgeLabel,
                            enabled: item.enabled,
                            stock: item.stock,
                            sortOrder: item.sortOrder,
                          }}
                        />
                        <div className="modal-actions">
                          <ModalCancel />
                          <SubmitButton>Сохранить</SubmitButton>
                        </div>
                      </ActionForm>
                      <div className="danger-zone">
                        <h3>Удалить товар</h3>
                        <p className="secondary" style={{ fontSize: 13, marginBottom: 10 }}>
                          {item._count.purchases > 0
                            ? "У товара есть покупки, поэтому он будет снят с продажи, а история сохранится."
                            : "Товар исчезнет из магазина насовсем."}
                        </p>
                        <ActionForm action={deleteShopItem} confirm={`Удалить «${item.name}»?`} confirmLabel="Удалить" danger>
                          <input type="hidden" name="id" value={item.id} />
                          <SubmitButton variant="danger">Удалить товар</SubmitButton>
                        </ActionForm>
                      </div>
                    </ModalTrigger>
                  </div>
                </div>
              ))}
            </div>
          </Section>
        ))}

      {tab === "requests" && (
        <>
          <ActionForm action={saveCustomRoleSettings}>
            <Section title="Проверка личных ролей" hint="Пока проверка включена, личная роль выдаётся только после одобрения в Discord.">
              <div className="tiles">
                <FieldRow icon="shield" label="Согласовывать личные роли" hint="Скрап списывается сразу и возвращается игроку, если заявку отклонят">
                  <Switch name="customRoleApproval" defaultChecked={settings.customRoleApproval} label="Согласовывать личные роли" />
                </FieldRow>
                <FieldRow icon="hash" label="Канал для заявок" hint="Туда бот присылает заявки с кнопками «Одобрить» и «Отклонить»">
                  <select name="approvalChannelId" defaultValue={settings.approvalChannelId ?? ""} style={{ minWidth: 240 }} aria-label="Канал для заявок">
                    <option value="">Не выбран</option>
                    {channels.map((c) => (
                      <option key={c.id} value={c.id}>
                        # {c.name}
                      </option>
                    ))}
                  </select>
                </FieldRow>
              </div>
              {settings.customRoleApproval && !settings.approvalChannelId && (
                <p className="notice warn" style={{ marginTop: 10 }}>
                  Канал не выбран: сейчас личные роли купить нельзя. Выбери канал или выключи проверку.
                </p>
              )}
              <p className="muted" style={{ fontSize: 12.5, marginTop: 10 }}>
                Решать заявки могут владелец, администраторы, люди с правом «Управлять ролями» и роли с доступом к панели. Боту нужны права на просмотр
                канала и отправку сообщений в нём, а для картинки-превью ещё «Прикреплять файлы».
              </p>
            </Section>
            <div className="save-bar">
              <SubmitButton>Сохранить</SubmitButton>
            </div>
          </ActionForm>

          <Section title="Заявки" hint="Последние 50. Решение принимается кнопками в Discord, здесь — история.">
            {requests.length === 0 ? (
              <EmptyState icon="users" title="Заявок пока нет" hint="Они появятся, когда кто-нибудь купит личную роль." />
            ) : (
              <div className="card" style={{ padding: "8px 8px 4px" }}>
                <table className="table">
                  <thead>
                    <tr>
                      <th>Игрок</th>
                      <th>Название</th>
                      <th>Статус</th>
                      <th>Кто решил</th>
                      <th>Когда</th>
                    </tr>
                  </thead>
                  <tbody>
                    {requests.map((r) => (
                      <tr key={r.id}>
                        <td>{r.purchase.member.displayName}</td>
                        <td>
                          <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                            <span className="dot" style={{ background: hex(r.color) ?? "var(--text-secondary)" }} />
                            <span style={{ color: hex(r.color) ?? undefined, fontWeight: 500 }}>{r.name}</span>
                          </span>
                        </td>
                        <td>
                          <span className={REQUEST_STATUS[r.status].chip}>{REQUEST_STATUS[r.status].label}</span>
                          {r.reason && <div className="muted" style={{ fontSize: 12, marginTop: 2 }}>{r.reason}</div>}
                        </td>
                        <td className="secondary">{r.decidedByName ?? "—"}</td>
                        <td className="secondary">{(r.decidedAt ?? r.createdAt).toLocaleString("ru-RU")}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Section>
        </>
      )}

      {tab === "history" &&
        (recent.length === 0 ? (
          <EmptyState icon="package" title="Покупок пока нет" hint="Здесь появятся покупки игроков из /shop." />
        ) : (
          <div className="card" style={{ padding: "8px 8px 4px" }}>
            <table className="table">
              <thead>
                <tr>
                  <th>Игрок</th>
                  <th>Товар</th>
                  <th className="num">Цена</th>
                  <th>Статус</th>
                  <th>Когда</th>
                </tr>
              </thead>
              <tbody>
                {recent.map((p) => (
                  <tr key={p.id}>
                    <td>{p.member.displayName}</td>
                    <td>
                      {p.item.name}
                      {p.customName && <span className="muted"> · {p.customName}</span>}
                    </td>
                    <td className="num">{formatNumber(p.price)}</td>
                    <td>
                      {p.active ? (
                        <span className="chip success">{p.expiresAt ? `до ${p.expiresAt.toLocaleDateString("ru-RU")}` : "Активна"}</span>
                      ) : (
                        <span className="chip">Завершена</span>
                      )}
                    </td>
                    <td className="secondary">{p.createdAt.toLocaleString("ru-RU")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}
    </>
  );
}
