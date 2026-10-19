import { getRatingSettings, prisma } from "@flamebot/core";
import { ActionForm, SubmitButton } from "@/components/ActionForm";
import { FieldRow, NumberInput } from "@/components/Fields";
import { requirePage } from "@/lib/auth";
import { saveRepSettings } from "../actions";

export const metadata = { title: "Репутация" };

export default async function RepPage() {
  await requirePage();
  const [s, recent] = await Promise.all([
    getRatingSettings(prisma),
    prisma.repTransaction.findMany({
      orderBy: { createdAt: "desc" },
      take: 30,
      include: { giver: true, receiver: true },
    }),
  ]);

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Репутация</h1>
          <p>Игроки дают друг другу +1 командой /rep. Ограничения ниже защищают от накрутки.</p>
        </div>
      </div>

      <div className="card">
        <div className="card-head"><h2>Ограничения</h2></div>
        <ActionForm action={saveRepSettings}>
          <FieldRow label="Как часто можно давать, часов" hint="Один /rep за это время">
            <NumberInput name="repCooldownHours" defaultValue={s.repCooldownHours} min={1} max={720} />
          </FieldRow>
          <FieldRow label="Повтор одному игроку, дней" hint="0 — без ограничения">
            <NumberInput name="repSameTargetDays" defaultValue={s.repSameTargetDays} min={0} max={365} />
          </FieldRow>
          <FieldRow label="Стаж на сервере, дней" hint="Новички и твинки не могут давать репутацию сразу после входа">
            <NumberInput name="repMinMemberDays" defaultValue={s.repMinMemberDays} min={0} max={365} />
          </FieldRow>
          <div className="form-actions">
            <SubmitButton>Сохранить</SubmitButton>
          </div>
        </ActionForm>
      </div>

      <div className="card">
        <div className="card-head"><h2>Последние /rep</h2></div>
        {recent.length === 0 ? (
          <p className="empty">Пока никто не давал репутацию.</p>
        ) : (
          <table className="table">
            <thead><tr><th>Кто</th><th>Кому</th><th>Когда</th></tr></thead>
            <tbody>
              {recent.map((r) => (
                <tr key={r.id}>
                  <td>{r.giver.displayName}</td>
                  <td>{r.receiver.displayName}</td>
                  <td className="secondary">{r.createdAt.toLocaleString("ru-RU")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}
