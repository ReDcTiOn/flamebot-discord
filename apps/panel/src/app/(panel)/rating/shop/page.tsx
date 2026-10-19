import { formatNumber, prisma, type ShopItem } from "@flamebot/core";
import { ActionForm, SubmitButton } from "@/components/ActionForm";
import { RoleSelect, Switch } from "@/components/Fields";
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

export default async function ShopPage() {
  await requirePage();
  const [items, roles, recent] = await Promise.all([
    prisma.shopItem.findMany({
      orderBy: [{ sortOrder: "asc" }, { price: "asc" }],
      include: { _count: { select: { purchases: true } } },
    }),
    listRoles(),
    prisma.purchase.findMany({ orderBy: { createdAt: "desc" }, take: 20, include: { item: true, member: true } }),
  ]);

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Магазин</h1>
          <p>Только товары в Discord. Роли с правами модерации продавать нельзя: панель и бот их не выдают.</p>
        </div>
      </div>

      <div className="card">
        <div className="card-head"><h2>Товары</h2></div>
        {items.length === 0 && <p className="empty">Товаров пока нет. Добавь первый ниже.</p>}
        {items.map((item) => (
          <details key={item.id} className="edit" style={{ borderTop: "1px solid var(--border)" }}>
            <summary style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, padding: "12px 8px" }}>
              <span>
                <span style={{ fontWeight: 500 }}>{item.name}</span>{" "}
                <span className="muted">· {TYPES[item.type].split(":")[0]}{item.durationDays ? ` · ${item.durationDays} д.` : ""}</span>
              </span>
              <span style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <span style={{ fontWeight: 500, fontVariantNumeric: "tabular-nums" }}>{formatNumber(item.price)}</span>
                <span className="muted">куплено {item._count.purchases}</span>
                <span className={item.enabled ? "chip success" : "chip"}>{item.enabled ? "В продаже" : "Скрыт"}</span>
              </span>
            </summary>
            <div style={{ padding: "4px 8px 14px" }}>
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

      <div className="card">
        <div className="card-head"><h2>Новый товар</h2></div>
        <ActionForm action={createShopItem} resetOnSuccess>
          <ItemFields roles={roles} />
          <div className="form-actions">
            <SubmitButton>Добавить товар</SubmitButton>
          </div>
        </ActionForm>
      </div>

      <div className="card">
        <div className="card-head"><h2>История покупок</h2></div>
        {recent.length === 0 ? (
          <p className="empty">Покупок пока нет.</p>
        ) : (
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
        )}
      </div>
    </>
  );
}
