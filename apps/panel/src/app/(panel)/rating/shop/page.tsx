import { formatNumber, prisma, type ShopItem } from "@flamebot/core";
import { ActionForm, SubmitButton } from "@/components/ActionForm";
import { EmptyState, PageHead, RoleSelect, Switch, Tabs, pickTab } from "@/components/Fields";
import { Icon } from "@/components/Icon";
import { requirePage } from "@/lib/auth";
import { listRoles } from "@/lib/guild";
import { createShopItem, deleteShopItem, updateShopItem } from "../actions";

export const metadata = { title: "Магазин" };

type Roles = Awaited<ReturnType<typeof listRoles>>;

const TYPES = {
  ROLE: "Роль сервера (цвет ника и т. п.)",
  CUSTOM_ROLE: "Личная роль: название и цвет выбирает игрок",
  BADGE: "Бейдж в профиль",
} as const;

function ItemFields({ item, roles }: { item?: ShopItem; roles: Roles }) {
  return (
    <>
      <div className="grid grid-3">
        <label className="stack"><span>Название</span>
          <input type="text" name="name" defaultValue={item?.name} maxLength={80} required className="wide" placeholder="Цвет ника · 30 дней" />
        </label>
        <label className="stack"><span>Тип</span>
          <select name="type" defaultValue={item?.type ?? "ROLE"} className="wide">
            {Object.entries(TYPES).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </label>
        <label className="stack"><span>Цена, скрап</span>
          <input type="number" name="price" defaultValue={item?.price ?? 500} min={1} required className="wide" />
        </label>
      </div>
      <label className="stack" style={{ marginTop: 10 }}><span>Описание</span>
        <input type="text" name="description" defaultValue={item?.description} maxLength={200} className="wide" placeholder="Коротко, что получит игрок" />
      </label>
      <div className="grid grid-3" style={{ marginTop: 10 }}>
        <label className="stack"><span>Роль (для типа «Роль сервера»)</span>
          <RoleSelect name="roleId" roles={roles} defaultValue={item?.roleId ?? null} />
        </label>
        <label className="stack"><span>Срок, дней (пусто — навсегда)</span>
          <input type="number" name="durationDays" defaultValue={item?.durationDays ?? ""} min={1} max={3650} className="wide" />
        </label>
        <label className="stack"><span>Текст бейджа (для типа «Бейдж»)</span>
          <input type="text" name="badgeLabel" defaultValue={item?.badgeLabel ?? ""} maxLength={40} className="wide" placeholder="Меценат" />
        </label>
      </div>
      <div className="grid grid-3" style={{ marginTop: 10, alignItems: "end" }}>
        <label className="stack"><span>Остаток (пусто — без ограничений)</span>
          <input type="number" name="stock" defaultValue={item?.stock ?? ""} min={0} className="wide" />
        </label>
        <label className="stack"><span>Порядок в списке</span>
          <input type="number" name="sortOrder" defaultValue={item?.sortOrder ?? 0} min={-1000} max={1000} className="wide" />
        </label>
        <label style={{ display: "flex", alignItems: "center", gap: 10, minHeight: 34 }}>
          <Switch name="enabled" defaultChecked={item?.enabled ?? true} label="В продаже" /> В продаже
        </label>
      </div>
    </>
  );
}

const TABS = [
  { key: "items", label: "Товары" },
  { key: "new", label: "Новый товар" },
  { key: "history", label: "История покупок" },
] as const;

const TYPE_ICON = { ROLE: "palette", CUSTOM_ROLE: "users", BADGE: "package" } as const;

export default async function ShopPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  await requirePage();
  const tab = pickTab((await searchParams).tab, TABS.map((t) => t.key));
  const [items, roles, recent] = await Promise.all([
    prisma.shopItem.findMany({
      orderBy: [{ sortOrder: "asc" }, { price: "asc" }],
      include: { _count: { select: { purchases: true } } },
    }),
    listRoles(),
    prisma.purchase.findMany({ orderBy: { createdAt: "desc" }, take: 30, include: { item: true, member: true } }),
  ]);

  return (
    <>
      <PageHead title="Магазин" hint="Только товары в Discord. Роли с правами модерации продавать нельзя: панель и бот их не выдают." />
      <Tabs tabs={[...TABS]} active={tab} base="/rating/shop" />

      {tab === "items" &&
        (items.length === 0 ? (
          <EmptyState icon="store" title="Товаров пока нет" hint="Добавь первый на вкладке «Новый товар»." />
        ) : (
          <div className="tiles">
            {items.map((item) => (
              <details key={item.id} className="edit setting" style={{ display: "block", padding: 0 }}>
                <summary style={{ display: "flex", alignItems: "center", gap: 14, padding: "12px 14px" }}>
                  <div className="setting-icon">
                    <Icon name={TYPE_ICON[item.type]} />
                  </div>
                  <div className="setting-body">
                    <div className="setting-title">{item.name}</div>
                    <div className="setting-hint">
                      {TYPES[item.type].split(":")[0]}
                      {item.durationDays ? ` · ${item.durationDays} д.` : " · навсегда"}
                      {` · куплено ${item._count.purchases}`}
                    </div>
                  </div>
                  <div className="setting-control">
                    <span style={{ fontWeight: 600, fontVariantNumeric: "tabular-nums" }}>{formatNumber(item.price)} скрапа</span>
                    <span className={item.enabled ? "chip success" : "chip"}>{item.enabled ? "В продаже" : "Скрыт"}</span>
                  </div>
                </summary>
                <div style={{ padding: "4px 14px 14px", borderTop: "1px solid var(--border)" }}>
                  <div style={{ height: 12 }} />
                  <ActionForm action={updateShopItem}>
                    <input type="hidden" name="id" value={item.id} />
                    <ItemFields item={item} roles={roles} />
                    <div className="form-actions">
                      <SubmitButton>Сохранить товар</SubmitButton>
                    </div>
                  </ActionForm>
                  <ActionForm action={deleteShopItem} confirm={`Удалить товар «${item.name}»?`}>
                    <input type="hidden" name="id" value={item.id} />
                    <div className="form-actions" style={{ marginTop: 0 }}>
                      <SubmitButton variant="danger">Удалить товар</SubmitButton>
                    </div>
                  </ActionForm>
                </div>
              </details>
            ))}
          </div>
        ))}

      {tab === "new" && (
        <div className="card">
          <ActionForm action={createShopItem} resetOnSuccess>
            <ItemFields roles={roles} />
            <div className="form-actions">
              <SubmitButton>Добавить товар</SubmitButton>
            </div>
          </ActionForm>
        </div>
      )}

      {tab === "history" && (
        recent.length === 0 ? (
          <EmptyState icon="package" title="Покупок пока нет" hint="Здесь появятся покупки игроков из /shop." />
        ) : (
        <div className="card">
          <table className="table">
            <thead><tr><th>Игрок</th><th>Товар</th><th className="num">Цена</th><th>Статус</th><th>Когда</th></tr></thead>
            <tbody>
              {recent.map((p) => (
                <tr key={p.id}>
                  <td>{p.member.displayName}</td>
                  <td>{p.item.name}{p.customName && <span className="muted"> · {p.customName}</span>}</td>
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
        )
      )}
    </>
  );
}
