import { GIVEAWAY_MESSAGES, getGiveawaySettings, giveawayMessageConfig, prisma, type GiveawayMessageKey } from "@flamebot/core";
import { ActionForm, SubmitButton } from "@/components/ActionForm";
import { PageHead, Section, Switch } from "@/components/Fields";
import { requirePage } from "@/lib/auth";
import { saveGiveawayMessages } from "../actions";

export const metadata = { title: "Сообщения розыгрышей" };

export default async function GiveawayMessagesPage() {
  await requirePage("full");
  const settings = await getGiveawaySettings(prisma);
  const keys = Object.keys(GIVEAWAY_MESSAGES) as GiveawayMessageKey[];
  const groups = [...new Set(keys.map(key => GIVEAWAY_MESSAGES[key].group))];

  return (
    <>
      <PageHead title="Сообщения" hint="Настрой тексты карточки розыгрыша, ответы в Discord и уведомления. Переменные в фигурных скобках бот подставляет сам." />
      <ActionForm action={saveGiveawayMessages}>
        {groups.map(group => (
          <Section key={group} title={group}>
            <div className="tiles group">
              {keys.filter(key => GIVEAWAY_MESSAGES[key].group === group).map(key => {
                const def = GIVEAWAY_MESSAGES[key];
                const saved = giveawayMessageConfig(settings, key);
                const vars = [...new Set(def.text.match(/\{\w+\}/g) ?? [])];
                const button = key.endsWith("Button");
                return (
                  <div key={key} className="setting" style={{ flexDirection: "column", alignItems: "stretch", gap: 8 }}>
                    <label className="setting-title" htmlFor={key}>{def.label}</label>
                    {def.optional && <Switch name={`${key}Enabled`} defaultChecked={saved.enabled} label={`Включить: ${def.label}`} />}
                    {button
                      ? <input id={key} name={key} className="wide" defaultValue={saved.text} maxLength={80} required />
                      : <textarea id={key} name={key} className="wide" defaultValue={saved.text} maxLength={1700} rows={key === "dm" ? 7 : 2} required />}
                    {vars.length > 0 && <div className="setting-hint">Подстановки {vars.map(v => <code key={v} style={{ marginLeft: 6 }}>{v}</code>)}</div>}
                    {key === "everyone" && <div className="setting-hint">Отдельный ответ на карточку. Для пинга бот должен иметь право упоминать @everyone в канале.</div>}
                  </div>
                );
              })}
            </div>
          </Section>
        ))}
        <div className="save-bar"><SubmitButton>Сохранить сообщения</SubmitButton></div>
      </ActionForm>
    </>
  );
}
