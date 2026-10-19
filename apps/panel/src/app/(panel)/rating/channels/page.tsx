import { getRatingSettings, prisma } from "@flamebot/core";
import { ActionForm, SubmitButton } from "@/components/ActionForm";
import { EmptyState, FieldRow, PageHead, Section } from "@/components/Fields";
import { requirePage } from "@/lib/auth";
import { listTextChannels } from "@/lib/guild";
import { saveChannelSettings } from "../actions";

export const metadata = { title: "Каналы" };

export default async function ChannelsPage() {
  await requirePage();
  const [s, channels] = await Promise.all([getRatingSettings(prisma), listTextChannels()]);

  if (channels.length === 0) {
    return (
      <>
        <PageHead title="Каналы" />
        <EmptyState icon="hash" title="Каналов пока нет" hint="Список появится, когда бот подключится к серверу." />
      </>
    );
  }

  return (
    <>
      <PageHead title="Каналы" hint="Где бот объявляет новые ранги, где не начисляет опыт и где принимает команды." />

      <ActionForm action={saveChannelSettings}>
        <Section title="Объявления">
          <FieldRow icon="megaphone" label="Канал для объявлений о новом ранге" hint="Если не выбран, бот пишет туда, где игрок получил ранг">
            <select name="announceChannelId" defaultValue={s.announceChannelId ?? ""} style={{ minWidth: 260 }} aria-label="Канал объявлений">
              <option value="">Тот же канал, где было сообщение</option>
              {channels.map((c) => (
                <option key={c.id} value={c.id}># {c.name}</option>
              ))}
            </select>
          </FieldRow>
        </Section>

        <Section title="Каналы без опыта" hint="Флуд, мемы, тикеты, боты. Сообщения здесь не дают опыта и скрапа.">
          <div className="check-list">
            {channels.map((c) => (
              <label key={c.id} className="check-item">
                <input type="checkbox" name="ignoredChannelIds" value={c.id} defaultChecked={s.ignoredChannelIds.includes(c.id)} />
                # {c.name}
              </label>
            ))}
          </div>
        </Section>

        <Section title="Каналы для команд" hint="Если ничего не отмечено, команды бота работают везде.">
          <div className="check-list">
            {channels.map((c) => (
              <label key={c.id} className="check-item">
                <input type="checkbox" name="commandChannelIds" value={c.id} defaultChecked={s.commandChannelIds.includes(c.id)} />
                # {c.name}
              </label>
            ))}
          </div>
        </Section>

        <div className="save-bar">
          <SubmitButton>Сохранить каналы</SubmitButton>
        </div>
      </ActionForm>
    </>
  );
}
