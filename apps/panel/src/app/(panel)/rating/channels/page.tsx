import { getRatingSettings, prisma } from "@flamebot/core";
import { ActionForm, SubmitButton } from "@/components/ActionForm";
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
        <div className="page-head"><div><h1>Каналы</h1></div></div>
        <p className="notice warn">Список каналов появится, когда бот подключится к серверу.</p>
      </>
    );
  }

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Каналы</h1>
          <p>Где бот объявляет новые ранги, где не начисляет опыт и где принимает команды.</p>
        </div>
      </div>

      <ActionForm action={saveChannelSettings}>
        <div className="card">
          <div className="card-head">
            <div>
              <h2>Объявления о новом ранге</h2>
              <p>Если канал не выбран, бот пишет туда, где игрок получил ранг.</p>
            </div>
          </div>
          <select name="announceChannelId" defaultValue={s.announceChannelId ?? ""} className="wide">
            <option value="">Тот же канал, где было сообщение</option>
            {channels.map((c) => (
              <option key={c.id} value={c.id}># {c.name}</option>
            ))}
          </select>
        </div>

        <div className="card">
          <div className="card-head">
            <div>
              <h2>Каналы без опыта</h2>
              <p>Флуд, мемы, боты. Сообщения здесь не дают опыта и скрапа.</p>
            </div>
          </div>
          <div className="check-list">
            {channels.map((c) => (
              <label key={c.id} className="check-item">
                <input type="checkbox" name="ignoredChannelIds" value={c.id} defaultChecked={s.ignoredChannelIds.includes(c.id)} />
                # {c.name}
              </label>
            ))}
          </div>
        </div>

        <div className="card">
          <div className="card-head">
            <div>
              <h2>Каналы для команд</h2>
              <p>Если ничего не отмечено, команды работают везде.</p>
            </div>
          </div>
          <div className="check-list">
            {channels.map((c) => (
              <label key={c.id} className="check-item">
                <input type="checkbox" name="commandChannelIds" value={c.id} defaultChecked={s.commandChannelIds.includes(c.id)} />
                # {c.name}
              </label>
            ))}
          </div>
          <div className="form-actions">
            <SubmitButton>Сохранить каналы</SubmitButton>
          </div>
        </div>
      </ActionForm>
    </>
  );
}
