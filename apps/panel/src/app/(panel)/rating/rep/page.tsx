import { getRatingSettings, prisma } from "@flamebot/core";
import { ActionForm, SubmitButton } from "@/components/ActionForm";
import { EmptyState, FieldRow, NumberInput, PageHead, Section, Tabs, pickTab } from "@/components/Fields";
import { requirePage } from "@/lib/auth";
import { saveRepSettings } from "../actions";

export const metadata = { title: "Репутация" };

const TABS = [
  { key: "limits", label: "Ограничения" },
  { key: "history", label: "История" },
] as const;

export default async function RepPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  await requirePage();
  const tab = pickTab((await searchParams).tab, TABS.map((t) => t.key));
  const [s, recent] = await Promise.all([
    getRatingSettings(prisma),
    tab === "history"
      ? prisma.repTransaction.findMany({ orderBy: { createdAt: "desc" }, take: 50, include: { giver: true, receiver: true } })
      : Promise.resolve([]),
  ]);

  return (
    <>
      <PageHead title="Репутация" hint="Игроки дают друг другу +1 командой /rep. Ограничения защищают от накрутки." />
      <Tabs tabs={[...TABS]} active={tab} base="/rating/rep" />

      {tab === "limits" && (
        <ActionForm action={saveRepSettings}>
          <Section title="Защита от накрутки">
            <div className="tiles">
              <FieldRow icon="clock" label="Как часто можно давать, часов" hint="Один /rep за это время">
                <NumberInput name="repCooldownHours" defaultValue={s.repCooldownHours} min={1} max={720} label="Часов" />
              </FieldRow>
              <FieldRow icon="repeat" label="Повтор одному игроку, дней" hint="0 — без ограничения">
                <NumberInput name="repSameTargetDays" defaultValue={s.repSameTargetDays} min={0} max={365} label="Дней" />
              </FieldRow>
              <FieldRow icon="shield" label="Стаж на сервере, дней" hint="Новички и твинки не могут давать репутацию сразу после входа">
                <NumberInput name="repMinMemberDays" defaultValue={s.repMinMemberDays} min={0} max={365} label="Дней" />
              </FieldRow>
            </div>
          </Section>
          <div className="save-bar">
            <SubmitButton>Сохранить изменения</SubmitButton>
          </div>
        </ActionForm>
      )}

      {tab === "history" &&
        (recent.length === 0 ? (
          <EmptyState icon="thumb" title="Пока пусто" hint="Здесь появятся последние /rep игроков." />
        ) : (
          <div className="card">
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
          </div>
        ))}
    </>
  );
}
