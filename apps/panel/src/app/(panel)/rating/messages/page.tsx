import { getRatingSettings, prisma } from "@flamebot/core";
import { ActionForm, SubmitButton } from "@/components/ActionForm";
import { PageHead, Section } from "@/components/Fields";
import { requirePage } from "@/lib/auth";
import { saveMessageSettings } from "../actions";

export const metadata = { title: "Сообщения" };

const PLACEHOLDERS = [
  ["{user}", "упоминание игрока"],
  ["{name}", "имя без упоминания"],
  ["{rank}", "новый ранг с эмодзи"],
  ["{reward}", "сколько скрапа за ранг"],
  ["{scrap_icon}", "эмодзи скрапа"],
] as const;

export default async function MessagesPage() {
  await requirePage();
  const s = await getRatingSettings(prisma);

  return (
    <>
      <PageHead title="Сообщения" hint="Тексты, которые бот пишет в чат." />

      <ActionForm action={saveMessageSettings}>
        <Section title="Новый ранг" hint="Бот упоминает только самого игрока. @everyone и @here в этом тексте не сработают.">
          <div className="setting" style={{ flexDirection: "column", alignItems: "stretch", gap: 10 }}>
            <textarea name="rankUpMessage" defaultValue={s.rankUpMessage} maxLength={500} required className="wide" rows={3} aria-label="Текст объявления" />
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
              {PLACEHOLDERS.map(([key, label]) => (
                <span key={key} className="chip">
                  <code style={{ background: "none", padding: 0 }}>{key}</code> {label}
                </span>
              ))}
            </div>
          </div>
        </Section>
        <div className="save-bar">
          <SubmitButton>Сохранить</SubmitButton>
        </div>
      </ActionForm>
    </>
  );
}
