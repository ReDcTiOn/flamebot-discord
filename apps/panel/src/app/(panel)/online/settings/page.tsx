import { prisma } from "@flamebot/core";
import { ActionForm, SubmitButton } from "@/components/ActionForm";
import { FieldRow, NumberInput, PageHead, Section } from "@/components/Fields";
import { requirePage } from "@/lib/auth";
import { saveOnlineSettings } from "../actions";

export const metadata = { title: "Настройки онлайна" };

export default async function OnlineSettingsPage() {
  await requirePage();
  const s = await prisma.onlineSettings.upsert({ where: { id: 1 }, update: {}, create: { id: 1 } });

  return (
    <>
      <PageHead title="Настройки" hint="Общие для всех серверов. После сохранения боты переподключатся в течение 10 секунд." />
      <ActionForm action={saveOnlineSettings}>
        <Section title="Тексты статуса в Discord" hint="Подстановки: {players} — игроков, {max} — слотов, {queued} — в очереди.">
          <div className="tiles group">
            <FieldRow icon="activity" label="Сервер онлайн" hint="Когда очереди нет">
              <input type="text" name="onlineText" defaultValue={s.onlineText} maxLength={128} required style={{ width: 320 }} />
            </FieldRow>
            <FieldRow icon="users" label="Онлайн с очередью">
              <input type="text" name="queueText" defaultValue={s.queueText} maxLength={128} required style={{ width: 320 }} />
            </FieldRow>
            <FieldRow icon="clock" label="Сервер запускается" hint="RCON уже отвечает, но serverinfo ещё не пришёл">
              <input type="text" name="startingText" defaultValue={s.startingText} maxLength={128} required style={{ width: 320 }} />
            </FieldRow>
            <FieldRow icon="server" label="Сервер выключен">
              <input type="text" name="offlineText" defaultValue={s.offlineText} maxLength={128} required style={{ width: 320 }} />
            </FieldRow>
          </div>
        </Section>

        <Section title="Подключение">
          <div className="tiles group">
            <FieldRow icon="repeat" label="Опрос сервера, секунд" hint="Как часто спрашивать онлайн и как долго ждать перед переподключением">
              <NumberInput name="pollIntervalSec" defaultValue={Math.round(s.pollIntervalMs / 1000)} min={2} max={300} label="Опрос, секунд" />
            </FieldRow>
            <FieldRow icon="clock" label="Ожидание подключения, секунд">
              <NumberInput name="connectTimeoutSec" defaultValue={Math.round(s.connectTimeoutMs / 1000)} min={3} max={120} label="Ожидание подключения" />
            </FieldRow>
            <FieldRow icon="clock" label="Тишина до переподключения, секунд" hint="Если сервер молчит дольше, соединение считается зависшим">
              <NumberInput name="responseTimeoutSec" defaultValue={Math.round(s.responseTimeoutMs / 1000)} min={10} max={600} label="Тишина до переподключения" />
            </FieldRow>
          </div>
        </Section>

        <div className="save-bar">
          <SubmitButton>Сохранить</SubmitButton>
        </div>
      </ActionForm>
    </>
  );
}
