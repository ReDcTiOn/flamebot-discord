import { LINK_TTL_MAX, LINK_TTL_MIN, getLinkSettings, prisma } from "@flamebot/core";
import { ActionForm, SubmitButton } from "@/components/ActionForm";
import { FieldRow, NumberInput, PageHead, RoleSelect, Section } from "@/components/Fields";
import { requirePage } from "@/lib/auth";
import { listRoles, listTextChannels } from "@/lib/guild";
import { saveLinkSettings } from "../actions";

export const metadata = { title: "Канал и роль" };

export default async function LinkSettingsPage() {
  await requirePage();
  const [s, roles, channels] = await Promise.all([getLinkSettings(prisma), listRoles(), listTextChannels()]);
  // Сообщение с кнопкой бот отправляет только в текстовый или новостной канал.
  const textChannels = channels.filter((c) => c.type === 0 || c.type === 5);

  return (
    <>
      <PageHead title="Канал и роль" hint="Бот применяет изменения в течение 15 секунд: отправит сообщение с кнопкой в выбранный канал или обновит уже отправленное." />
      {roles.length === 0 && (
        <p className="notice warn">Список ролей и каналов пуст: его присылает бот рейтинга. Запусти его хотя бы раз, и списки появятся.</p>
      )}
      <ActionForm action={saveLinkSettings}>
        <Section title="Где привязывать" hint="В канале будет одно сообщение с кнопкой. Нажав её, игрок вводит код, который получил в игре командой /connect.">
          <div className="tiles group">
            <FieldRow icon="hash" label="Канал с кнопкой" hint="Сменишь канал — бот уберёт сообщение из прежнего и отправит в новый">
              <select name="channelId" defaultValue={s.channelId ?? ""} className="wide" aria-label="Канал с кнопкой">
                <option value="">Не выбран: привязка выключена</option>
                {textChannels.map((c) => (
                  <option key={c.id} value={c.id}>
                    # {c.name}
                  </option>
                ))}
              </select>
            </FieldRow>
            <FieldRow icon="shield" label="Роль за привязку" hint="Бот выдаёт её сразу после привязки и возвращает, если роль сняли или человек перезашёл на сервер">
              <RoleSelect name="roleId" roles={roles} defaultValue={s.roleId} />
            </FieldRow>
            <FieldRow icon="clock" label="Срок кода, минут" hint="Сколько действует код из игры. Повторный /connect, пока код действует, покажет тот же код">
              <NumberInput name="codeTtlMinutes" defaultValue={s.codeTtlMinutes} min={LINK_TTL_MIN} max={LINK_TTL_MAX} label="Срок кода, минут" />
            </FieldRow>
          </div>
        </Section>

        <Section title="Сообщение в канале" hint="Поддерживается разметка Discord: **жирный**, [ссылка](https://…), эмодзи.">
          <div className="setting" style={{ flexDirection: "column", alignItems: "stretch", gap: 10 }}>
            <label className="stack">
              <span className="prop-label">Заголовок</span>
              <input type="text" name="panelTitle" defaultValue={s.panelTitle} maxLength={200} required className="wide" />
            </label>
            <label className="stack">
              <span className="prop-label">Текст</span>
              <textarea name="panelText" defaultValue={s.panelText} maxLength={3500} required className="wide" rows={9} />
            </label>
            <label className="stack">
              <span className="prop-label">Подпись кнопки</span>
              <input type="text" name="buttonLabel" defaultValue={s.buttonLabel} maxLength={80} required style={{ width: 240 }} />
            </label>
          </div>
        </Section>

        <div className="save-bar">
          <SubmitButton>Сохранить</SubmitButton>
        </div>
      </ActionForm>
    </>
  );
}
