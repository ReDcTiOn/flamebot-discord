import { GIVEAWAY_MESSAGES, getGiveawaySettings, giveawayMessageConfig, giveawayMessageLength, giveawayMessageSupportsEmbed, prisma, type GiveawayMessageKey } from "@flamebot/core";
import { ActionForm, SubmitButton } from "@/components/ActionForm";
import { PageHead, Section, Switch } from "@/components/Fields";
import { requirePage } from "@/lib/auth";
import { saveGiveawayMessages } from "../actions";
import { MessageEditor } from "./MessageEditor";

export const metadata = { title: "Сообщения розыгрышей" };

export default async function GiveawayMessagesPage() {
  await requirePage("full");
  const settings = await getGiveawaySettings(prisma);
  const keys = Object.keys(GIVEAWAY_MESSAGES) as GiveawayMessageKey[];
  const groups = [...new Set(keys.map(key => GIVEAWAY_MESSAGES[key].group))];

  return (
    <>
      <PageHead title="Сообщения" hint="Настрой тексты карточки розыгрыша, ответы в Discord и уведомления. Переменные в фигурных скобках бот подставляет сам." />
      <Section title="Форматирование Discord">
        <details className="setting-body">
          <summary>Примеры Markdown</summary>
          <ul>
            <li><code>**жирный**</code>, <code>*курсив*</code>, <code>__подчёркивание__</code></li>
            <li><code>-# Мелкий текст</code> в начале строки. После <code>#</code> нужен пробел.</li>
            <li><code>## Заголовок</code> или <code>- Пункт списка</code> в начале строки.</li>
            <li><code>||спойлер||</code>, <code>`код`</code>, <code>[ссылка](https://flamerust.gg)</code></li>
          </ul>
          <p>У кнопок форматирование не применяется. Для текстовых блоков внутри карточки используется разметка Components V2.</p>
        </details>
      </Section>
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
                      : <MessageEditor field={key} label={def.label} saved={saved} canEmbed={giveawayMessageSupportsEmbed(key)} maxLength={giveawayMessageLength(key)} rows={key === "dm" ? 7 : 2} />}
                    {vars.length > 0 && <div className="setting-hint">Подстановки {vars.map(v => <code key={v} style={{ marginLeft: 6 }}>{v}</code>)}</div>}
                    {key === "everyone" && <div className="setting-hint">Строка над карточкой в том же сообщении. Для пинга бот должен иметь право упоминать @everyone в канале.</div>}
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
