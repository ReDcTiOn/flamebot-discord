import { ActionForm, SubmitButton } from "@/components/ActionForm";
import { FieldRow, PageHead, Section, Switch } from "@/components/Fields";
import { requirePage } from "@/lib/auth";
import { mapsView } from "@/lib/maps";
import { saveMapsSettings } from "../actions";

export const metadata = { title: "Настройки карт" };

const W = { width: 300 };

export default async function MapsSettingsPage() {
  const user = await requirePage();
  const { s } = await mapsView();

  return (
    <>
      <PageHead
        title="Настройки"
        hint={`Бот применяет изменения в течение 5 секунд. Ключи и токены — в разделе «Подключение»${user.level === "full" ? "" : " (только для администраторов сервера)"}.`}
      />
      <ActionForm action={saveMapsSettings}>
        <Section title="Расписание" hint="Пояс, в котором заданы времена вайпов, и когда что происходит относительно вайпа.">
          <div className="tiles group">
            <FieldRow icon="clock" label="Часовой пояс" hint="Например Europe/Moscow">
              <input type="text" name="timezone" defaultValue={s.timezone} required maxLength={64} style={W} />
            </FieldRow>
            <FieldRow icon="message" label="Подпись пояса" hint="Рядом со временем: «чт 22.10 17:00 МСК»">
              <input type="text" name="timezoneLabel" defaultValue={s.timezoneLabel} required maxLength={20} style={W} />
            </FieldRow>
            <FieldRow icon="megaphone" label="Анонс в Discord, часов до вайпа" hint="Подтверждённые карты уходят в Discord в это время">
              <input type="number" name="sendLeadHours" defaultValue={s.sendLeadHours} required min={0} max={168} step={0.5} aria-label="Анонс, часов до вайпа" />
            </FieldRow>
            <FieldRow icon="repeat" label="Генерация, часов до анонса" hint="Сколько времени есть на выбор карт до анонса">
              <input type="number" name="genLeadHours" defaultValue={s.genLeadHours} required min={0} max={168} step={0.5} aria-label="Генерация, часов до анонса" />
            </FieldRow>
            <FieldRow icon="trending" label="Автоподбор" hint="Бот сам выбирает лучшие карты и предлагает набор целиком">
              <Switch name="autoPick" defaultChecked={s.autoPick} label="Автоподбор" />
            </FieldRow>
          </div>
        </Section>

        <Section title="Telegram" hint="Токен бота — в «Подключении». Узнать свой Telegram ID можно у @userinfobot.">
          <div className="tiles group">
            <FieldRow icon="users" label="Telegram ID админов" hint="Через запятую. Только они могут нажимать кнопки и писать боту">
              <input type="text" name="telegramAdminIds" defaultValue={s.telegramAdminIds.join(", ")} maxLength={400} style={W} placeholder="123456789, 987654321" />
            </FieldRow>
            <FieldRow icon="message" label="Чат для сообщений" hint="ID чата или группы. Пусто — личка первого админа">
              <input type="text" name="telegramChatId" defaultValue={s.telegramChatId ?? ""} maxLength={21} style={W} placeholder="-1001234567890" />
            </FieldRow>
          </div>
        </Section>

        <Section title="RustMaps">
          <div className="tiles group">
            <FieldRow icon="layers" label="Организация" hint="Только если генерации идут от организации (заголовок x-org-id)">
              <input type="text" name="rustmapsOrgId" defaultValue={s.rustmapsOrgId ?? ""} maxLength={100} style={W} />
            </FieldRow>
          </div>
        </Section>

        <Section title="Хранилище S3" hint="Ключи доступа — в «Подключении». Ссылка на карту: адрес CDN/префикс/папка сервера/файл.">
          <div className="tiles group">
            <FieldRow icon="server" label="Адрес S3" hint="Selectel → Объектное хранилище → Доступ">
              <input type="url" name="s3Endpoint" defaultValue={s.s3Endpoint} maxLength={300} style={W} placeholder="https://s3.ru-1.storage.selcloud.ru" />
            </FieldRow>
            <FieldRow icon="server" label="Регион">
              <input type="text" name="s3Region" defaultValue={s.s3Region} maxLength={50} style={W} placeholder="ru-1" />
            </FieldRow>
            <FieldRow icon="package" label="Бакет (контейнер)">
              <input type="text" name="s3Bucket" defaultValue={s.s3Bucket} maxLength={63} style={W} />
            </FieldRow>
            <FieldRow icon="layers" label="Префикс" hint="Папка внутри бакета для всех карт">
              <input type="text" name="s3Prefix" defaultValue={s.s3Prefix} maxLength={100} style={W} placeholder="maps" />
            </FieldRow>
            <FieldRow icon="repeat" label="Адресация" hint="Если загрузка падает, «Проверить подключения» подскажет, какая подходит">
              <select name="s3Addressing" defaultValue={s.s3Addressing} aria-label="Адресация">
                <option value="path">path (адрес/бакет/ключ)</option>
                <option value="virtual">virtual (бакет.адрес/ключ)</option>
              </select>
            </FieldRow>
            <FieldRow icon="activity" label="Адрес CDN" hint="Публичный адрес бакета, без / в конце">
              <input type="url" name="cdnBaseUrl" defaultValue={s.cdnBaseUrl} maxLength={300} style={W} placeholder="https://…selstorage.ru" />
            </FieldRow>
          </div>
        </Section>

        <Section title="Pterodactyl" hint="Бот записывает ссылки на карты в задачи вайпа (аддон Rust Server Wiper) и включает «Wipe Blueprints» на глобальных вайпах. Ключ ptlc_ — в «Подключении», серверы — в «Серверах».">
          <div className="tiles group">
            <FieldRow icon="server" label="Адрес панели">
              <input type="url" name="pteroUrl" defaultValue={s.pteroUrl ?? ""} maxLength={300} style={W} placeholder="https://panel.example.com" />
            </FieldRow>
            <FieldRow icon="clock" label="Спросить, часов до вайпа">
              <input type="number" name="panelAskHours" defaultValue={s.panelAskHours} required min={1} max={72} aria-label="Спросить, часов до вайпа" />
            </FieldRow>
            <FieldRow icon="repeat" label="Напоминать, каждые N минут">
              <input type="number" name="panelRemindMinutes" defaultValue={s.panelRemindMinutes} required min={10} max={1440} aria-label="Напоминать, минут" />
            </FieldRow>
            <FieldRow icon="clock" label="Записать самому, минут до вайпа" hint="Если на вопрос никто не ответил">
              <input type="number" name="panelAutoMinutes" defaultValue={s.panelAutoMinutes} required min={5} max={600} aria-label="Записать самому, минут до вайпа" />
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
