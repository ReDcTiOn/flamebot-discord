import { getRatingSettings, prisma } from "@flamebot/core";
import { ActionForm, SubmitButton } from "@/components/ActionForm";
import { requirePage } from "@/lib/auth";
import { saveMessageSettings } from "../actions";

export const metadata = { title: "Сообщения" };

const PLACEHOLDERS = [
  ["{user}", "упоминание игрока"],
  ["{name}", "имя игрока без упоминания"],
  ["{rank}", "название нового ранга с эмодзи"],
  ["{reward}", "сколько скрапа выдано за ранг"],
] as const;

export default async function MessagesPage() {
  await requirePage();
  const s = await getRatingSettings(prisma);

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Сообщения</h1>
          <p>Тексты, которые бот пишет в чат.</p>
        </div>
      </div>

      <div className="card">
        <div className="card-head">
          <div>
            <h2>Новый ранг</h2>
            <p>Бот упоминает только самого игрока. @everyone и @here в этом тексте не сработают.</p>
          </div>
        </div>
        <ActionForm action={saveMessageSettings}>
          <textarea name="rankUpMessage" defaultValue={s.rankUpMessage} maxLength={500} required className="wide" rows={3} />
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 10 }}>
            {PLACEHOLDERS.map(([key, label]) => (
              <span key={key} className="chip">
                <code style={{ background: "none", padding: 0 }}>{key}</code> {label}
              </span>
            ))}
          </div>
          <div className="form-actions">
            <SubmitButton>Сохранить</SubmitButton>
          </div>
        </ActionForm>
      </div>
    </>
  );
}
