import { GIVEAWAY_MAX_WINNERS, getGiveawaySettings, prisma } from "@flamebot/core";
import { ActionForm, SubmitButton } from "@/components/ActionForm";
import { FieldRow, NumberInput, PageHead, Section, Switch } from "@/components/Fields";
import { requirePage } from "@/lib/auth";
import { saveGiveawaySettings } from "../actions";

export const metadata = { title: "Настройки розыгрышей" };

const ZONES = [
  ["Asia/Vladivostok", "Владивосток"],
  ["Asia/Khabarovsk", "Хабаровск"],
  ["Asia/Yakutsk", "Якутск"],
  ["Asia/Irkutsk", "Иркутск"],
  ["Asia/Krasnoyarsk", "Красноярск"],
  ["Asia/Novosibirsk", "Новосибирск"],
  ["Asia/Omsk", "Омск"],
  ["Asia/Yekaterinburg", "Екатеринбург"],
  ["Europe/Samara", "Самара"],
  ["Europe/Moscow", "Москва"],
  ["Europe/Kaliningrad", "Калининград"],
] as const;

const DAYS = [
  [0, "Сегодня"],
  [1, "Завтра"],
  [2, "Послезавтра"],
  [3, "Через 3 дня"],
  [7, "Через неделю"],
] as const;

export default async function GiveawaySettingsPage() {
  await requirePage();
  const s = await getGiveawaySettings(prisma);
  const days = DAYS.some(([d]) => d === s.quickDaysAhead) ? DAYS : [...DAYS, [s.quickDaysAhead, `Через ${s.quickDaysAhead} дн.`] as const];

  return (
    <>
      <PageHead title="Настройки" hint="Бот применяет изменения в течение 15 секунд. Подсказки команды /розыгрыш в Discord обновятся в течение минуты." />
      <ActionForm action={saveGiveawaySettings}>
        <Section title="Часовой пояс" hint="В нём админы вводят дату и время итогов в Discord. Участники видят время итогов в своём поясе автоматически.">
          <div className="tiles group">
            <FieldRow icon="clock" label="Часовой пояс" hint="Название из базы часовых поясов, например Asia/Vladivostok">
              <input type="text" name="timezone" defaultValue={s.timezone} list="giveaway-zones" maxLength={64} required style={{ width: 240 }} />
              <datalist id="giveaway-zones">
                {ZONES.map(([zone, label]) => (
                  <option key={zone} value={zone}>{label}</option>
                ))}
              </datalist>
            </FieldRow>
            <FieldRow icon="message" label="Подпись пояса" hint="Показывается рядом со временем: «20:00 (Владивосток)»">
              <input type="text" name="timezoneLabel" defaultValue={s.timezoneLabel} maxLength={40} required style={{ width: 240 }} />
            </FieldRow>
          </div>
        </Section>

        <Section title="Сообщение победителю" hint="Приходит в личные сообщения вместе с промокодом. Поддерживается разметка Discord: **жирный**, [ссылка](https://…).">
          <div className="setting" style={{ flexDirection: "column", alignItems: "stretch", gap: 10 }}>
            <textarea name="promoDmText" defaultValue={s.promoDmText} maxLength={1700} required className="wide" rows={10} aria-label="Сообщение победителю" />
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
              {[
                ["{prize}", "название приза"],
                ["{code}", "промокод — обязательно"],
              ].map(([key, label]) => (
                <span key={key} className="chip">
                  <code style={{ background: "none", padding: 0 }}>{key}</code> {label}
                </span>
              ))}
            </div>
          </div>
        </Section>

        <Section title="Быстрый розыгрыш" hint="Команда /розыгрыш быстрый: розыгрыш с этими настройками в текущем канале, остаётся только вставить промокоды.">
          <div className="tiles group">
            <FieldRow icon="gift" label="Приз">
              <input type="text" name="quickPrize" defaultValue={s.quickPrize} maxLength={200} required style={{ width: 280 }} />
            </FieldRow>
            <FieldRow icon="users" label="Победителей" hint="Столько же промокодов нужно будет вставить">
              <NumberInput name="quickWinners" defaultValue={s.quickWinners} min={1} max={GIVEAWAY_MAX_WINNERS} label="Победителей" />
            </FieldRow>
            <FieldRow icon="clock" label="День итогов" hint="Считается от дня, когда вызвана команда">
              <select name="quickDaysAhead" defaultValue={s.quickDaysAhead} aria-label="День итогов">
                {days.map(([d, label]) => (
                  <option key={d} value={d}>{label}</option>
                ))}
              </select>
            </FieldRow>
            <FieldRow icon="clock" label="Время итогов" hint={`По поясу «${s.timezoneLabel}»`}>
              <input type="time" name="quickTime" defaultValue={s.quickTime} required aria-label="Время итогов" />
            </FieldRow>
            <FieldRow icon="ticket" label="Только для бустеров" hint="Участвовать смогут только те, кто бустит сервер">
              <Switch name="quickBoostersOnly" defaultChecked={s.quickBoostersOnly} label="Только для бустеров" />
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
