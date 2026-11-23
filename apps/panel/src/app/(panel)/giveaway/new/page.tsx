import Link from "next/link";
import { GIVEAWAY_MAX_WINNERS, GIVEAWAY_REPEAT_OPTIONS, addDays, getGiveawaySettings, prisma, today, type CalendarDate } from "@flamebot/core";
import { ActionForm, SubmitButton } from "@/components/ActionForm";
import { EmptyState, FieldRow, NumberInput, PageHead, Section, Switch } from "@/components/Fields";
import { requirePage } from "@/lib/auth";
import { getBotStates } from "@/lib/botState";
import { createGiveaway } from "../actions";
import { PromoFields, ScheduleFields } from "./PublicationFields";

export const metadata = { title: "Новый розыгрыш" };

const pad = (n: number) => String(n).padStart(2, "0");
// Формат поля <input type="date">.
const isoDate = (d: CalendarDate) => `${d.year}-${pad(d.month)}-${pad(d.day)}`;

export default async function NewGiveawayPage() {
  await requirePage();
  const [s, botState, channels, categories] = await Promise.all([
    getGiveawaySettings(prisma),
    getBotStates(["giveaway"]).then((st) => st.giveaway!),
    // Текстовые и новостные каналы: в форум бот розыгрыш не отправит.
    prisma.guildChannel.findMany({ where: { type: { in: [0, 5] } }, orderBy: [{ position: "asc" }, { name: "asc" }] }),
    prisma.guildChannel.findMany({ where: { type: 4 }, orderBy: { position: "asc" } }),
  ]);

  // Каналы по категориям, как в Discord. Каналы без категории — первыми.
  const groups = [
    { id: null as string | null, name: "Без категории" },
    ...categories.map((c) => ({ id: c.id as string | null, name: c.name })),
  ]
    .map((g) => ({ ...g, channels: channels.filter((c) => (c.parentId ?? null) === g.id) }))
    .filter((g) => g.channels.length > 0);

  const now = today(s.timezone);
  const defaultDate = addDays(now, s.quickDaysAhead);

  return (
    <>
      <PageHead
        title="Новый розыгрыш"
        hint={`Выбери канал и опубликуй розыгрыш сразу или по расписанию. Время по поясу «${s.timezoneLabel}».`}
      />

      {botState.tone !== "on" && (
        <p className="notice warn">
          Бот розыгрышей сейчас не работает ({botState.label.toLowerCase()}). Розыгрыш сохранится и появится в канале, когда бот запустится, если время
          итогов к тому моменту не пройдёт.
        </p>
      )}

      {channels.length === 0 ? (
        <EmptyState
          icon="hash"
          title="Список каналов пуст"
          hint="Его записывает бот рейтинга при запуске. Запусти бота рейтинга, и каналы появятся здесь."
        />
      ) : (
        <ActionForm action={createGiveaway} resetOnSuccess>
          <Section title="Розыгрыш" hint="Поля заполнены по шаблону быстрого розыгрыша из настроек.">
            <div className="tiles group">
              <FieldRow icon="gift" label="Приз" hint="Что разыгрывается">
                <input type="text" name="prize" defaultValue={s.quickPrize} maxLength={200} required style={{ width: 280 }} />
              </FieldRow>
              <FieldRow icon="users" label="Победителей" hint="Каждый получает приз">
                <NumberInput name="winners" defaultValue={s.quickWinners} min={1} max={GIVEAWAY_MAX_WINNERS} label="Победителей" />
              </FieldRow>
              <FieldRow icon="hash" label="Канал" hint="Куда бот отправит розыгрыш">
                <select name="channelId" required defaultValue="" aria-label="Канал" style={{ width: 280 }}>
                  <option value="" disabled>
                    Выбери канал
                  </option>
                  {groups.map((g) => (
                    <optgroup key={g.id ?? "none"} label={g.name}>
                      {g.channels.map((c) => (
                        <option key={c.id} value={c.id}>
                          # {c.name}
                        </option>
                      ))}
                    </optgroup>
                  ))}
                </select>
              </FieldRow>
              <FieldRow icon="ticket" label="Только для бустеров" hint="Участвовать смогут только те, кто бустит сервер">
                <Switch name="boostersOnly" defaultChecked={s.quickBoostersOnly} label="Только для бустеров" />
              </FieldRow>
            </div>
          </Section>

          <ScheduleFields today={isoDate(now)} defaultDate={isoDate(defaultDate)} defaultTime={s.quickTime} timezone={s.timezoneLabel} repeatOptions={GIVEAWAY_REPEAT_OPTIONS} defaultRepeat={s.defaultRepeatEveryDays} />

          <Section title="Описание" hint="Необязательно: условия или подробности. Показывается в сообщении розыгрыша.">
            <div className="setting" style={{ flexDirection: "column", alignItems: "stretch" }}>
              <textarea name="description" maxLength={1000} rows={3} className="wide" aria-label="Описание" placeholder="Например: условие — быть на сервере до итогов" />
            </div>
          </Section>

          <PromoFields />

          <div className="save-bar" style={{ gap: 8 }}>
            <Link href="/giveaway" className="btn">
              Отмена
            </Link>
            <SubmitButton>Создать розыгрыш</SubmitButton>
          </div>
        </ActionForm>
      )}
    </>
  );
}
