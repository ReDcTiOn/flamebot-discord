import { NOTICE_KIND_LABEL, prisma } from "@flamebot/core";
import { ActionForm, SubmitButton } from "@/components/ActionForm";
import { FieldRow, NumberInput, PageHead, Section, Switch } from "@/components/Fields";
import { requirePage } from "@/lib/auth";
import { noticesView } from "@/lib/notices";
import { saveNoticeSettings, uploadNoticeImage } from "../actions";

export const metadata = { title: "Настройки объявлений" };

const W = { width: 320 };
const when = (d: Date) => d.toLocaleString("ru-RU", { dateStyle: "short", timeStyle: "short" });

export default async function NoticeSettingsPage() {
  await requirePage();
  const { s } = await noticesView();
  const images = await prisma.noticeImage.findMany({ select: { kind: true, size: true, mime: true, updatedAt: true, updatedByName: true } });

  return (
    <>
      <PageHead title="Настройки" hint="Ключи и токены — в «Подключении». Изменения бот подхватывает в течение 5 секунд, без перезапуска." />
      <ActionForm action={saveNoticeSettings}>
        <Section title="Время">
          <div className="tiles group">
            <FieldRow icon="clock" label="Часовой пояс" hint="Расписание, план дня и срок промокода — по этому поясу">
              <input type="text" name="timezone" defaultValue={s.timezone} required maxLength={64} style={W} />
            </FieldRow>
            <FieldRow icon="clock" label="Подпись пояса" hint="Как писать время в сообщениях">
              <input type="text" name="timezoneLabel" defaultValue={s.timezoneLabel} required maxLength={20} style={W} />
            </FieldRow>
            <FieldRow icon="message" label="Присылать текст на подтверждение, часов до вайпа">
              <input type="text" name="notifyHours" defaultValue={String(Math.round((s.notifyMinutes / 60) * 100) / 100)} required inputMode="decimal" style={{ width: 120 }} aria-label="Часов до вайпа" />
            </FieldRow>
            <FieldRow icon="repeat" label="Напомнить, если не подтвердили, минут до вайпа" hint="0 — не напоминать">
              <NumberInput name="remindMinutes" defaultValue={s.remindMinutes} min={0} max={1440} label="Напоминание" />
            </FieldRow>
            <FieldRow icon="clock" label="Допустимое опоздание, минут" hint="Бот был выключен и время отправки прошло больше чем на столько — ничего не отправлять">
              <NumberInput name="maxLateMinutes" defaultValue={s.maxLateMinutes} min={1} max={1440} label="Опоздание" />
            </FieldRow>
            <FieldRow icon="shield" label="Пробный режим" hint="Наружу ничего не уходит, промокоды не создаются: удобно для проверки">
              <Switch name="dryRun" defaultChecked={s.dryRun} label="Пробный режим" />
            </FieldRow>
          </div>
        </Section>

        <Section title="Telegram" hint="Токен бота — в «Подключении». Узнать свой Telegram ID можно у @userinfobot.">
          <div className="tiles group">
            <FieldRow icon="users" label="Telegram ID админов" hint="Через запятую. Им приходят тексты на подтверждение и план дня, только они нажимают кнопки">
              <input type="text" name="telegramAdminIds" defaultValue={s.telegramAdminIds.join(", ")} maxLength={400} style={W} placeholder="123456789, 987654321" />
            </FieldRow>
          </div>
        </Section>

        <Section title="ВКонтакте" hint="Ключ сообщества не может загружать фото (ошибка VK 27), поэтому картинки один раз загружают в альбом сообщества вручную и указывают их ID: vk.com/photo-123456_789012 → photo-123456_789012 или вся ссылка.">
          <div className="tiles group">
            <FieldRow icon="hash" label="ID сообщества" hint="Число, минус можно не ставить">
              <input type="text" name="vkGroupId" defaultValue={s.vkGroupId ?? ""} inputMode="numeric" maxLength={15} style={W} />
            </FieldRow>
            <FieldRow icon="image" label="Фото: обычный вайп">
              <input type="text" name="vkPhotoRegular" defaultValue={s.vkPhotoRegular ?? ""} maxLength={200} style={W} placeholder="photo-123456_789012" />
            </FieldRow>
            <FieldRow icon="image" label="Фото: глобальный вайп">
              <input type="text" name="vkPhotoGlobal" defaultValue={s.vkPhotoGlobal ?? ""} maxLength={200} style={W} placeholder="photo-123456_789013" />
            </FieldRow>
            <FieldRow icon="hash" label="Тестовое сообщество" hint="Для тестовых прогонов. Пусто — тест не публикует во ВКонтакте">
              <input type="text" name="testVkGroupId" defaultValue={s.testVkGroupId ?? ""} inputMode="numeric" maxLength={15} style={W} />
            </FieldRow>
            <FieldRow icon="image" label="Тестовое фото: обычный">
              <input type="text" name="testVkPhotoRegular" defaultValue={s.testVkPhotoRegular ?? ""} maxLength={200} style={W} />
            </FieldRow>
            <FieldRow icon="image" label="Тестовое фото: глобальный">
              <input type="text" name="testVkPhotoGlobal" defaultValue={s.testVkPhotoGlobal ?? ""} maxLength={200} style={W} />
            </FieldRow>
          </div>
        </Section>

        <Section title="Промокод gamestores" hint="Создаётся при подтверждении текста, у которого указана скидка. Секретный ключ магазина — в «Подключении». Создание промокодов — непубличный метод: доступ выдаёт поддержка gamestores.">
          <div className="tiles group">
            <FieldRow icon="store" label="ID магазина">
              <input type="text" name="gamestoresStoreId" defaultValue={s.gamestoresStoreId ?? ""} maxLength={64} style={W} />
            </FieldRow>
            <FieldRow icon="ticket" label="Код промокода">
              <input type="text" name="promoCode" defaultValue={s.promoCode} required maxLength={32} style={W} />
            </FieldRow>
            <FieldRow icon="ticket" label="Тип">
              <select name="promoType" defaultValue={s.promoType} style={W}>
                <option value="discount">скидка, %</option>
                <option value="money">деньги на баланс</option>
                <option value="item">товар</option>
              </select>
            </FieldRow>
            <FieldRow icon="clock" label="Действует суток после дня вайпа" hint="1 — вторник → до среды, пятница → до субботы">
              <NumberInput name="promoDaysAfter" defaultValue={s.promoDaysAfter} min={0} max={30} label="Суток после вайпа" />
            </FieldRow>
            <FieldRow icon="clock" label="До какого времени">
              <input type="time" name="promoEndTime" defaultValue={s.promoEndTime} required style={{ width: 120 }} />
            </FieldRow>
            <FieldRow icon="users" label="Сколько раз можно использовать" hint="0 — без ограничения">
              <NumberInput name="promoLimitUses" defaultValue={s.promoLimitUses} min={0} max={100000} label="Использований" />
            </FieldRow>
            <FieldRow icon="shield" label="Тесты создают настоящий промокод" hint="TEST-…, скидка 1%, одно использование. Выключено — тест промокод не создаёт">
              <Switch name="promoTestReal" defaultChecked={s.promoTestReal} label="Тестовый промокод" />
            </FieldRow>
          </div>
        </Section>

        <Section title="План дня" hint="Пункты плана и напоминания — в разделе «План дня».">
          <div className="tiles group">
            <FieldRow icon="list" label="Присылать план дня и напоминания">
              <Switch name="agendaEnabled" defaultChecked={s.agendaEnabled} label="План дня" />
            </FieldRow>
            <FieldRow icon="clock" label="Во сколько присылать план">
              <input type="time" name="agendaSendAt" defaultValue={s.agendaSendAt} required style={{ width: 120 }} />
            </FieldRow>
            <FieldRow icon="clock" label="Сколько минут ещё присылать, если бот был выключен">
              <NumberInput name="agendaGraceMinutes" defaultValue={s.agendaGraceMinutes} min={0} max={1440} label="Опоздание плана" />
            </FieldRow>
            <FieldRow icon="message" label="Приветствие">
              <input type="text" name="agendaGreeting" defaultValue={s.agendaGreeting} required maxLength={100} style={W} />
            </FieldRow>
          </div>
        </Section>

        <div className="save-bar">
          <SubmitButton>Сохранить</SubmitButton>
        </div>
      </ActionForm>

      <Section title="Картинки постов" hint="Прикрепляются к объявлению в Discord и, если не указан ID фото, во ВКонтакте. PNG, JPEG или WebP до 15 МБ; больше 9,5 МБ бот пересохранит в JPEG — это лимит вложения Discord.">
        <div className="server-grid">
          {(["regular", "global"] as const).map((kind) => {
            const img = images.find((i) => i.kind === kind);
            return (
              <div key={kind} className="server-card">
                <div className="server-card-head">
                  <div className="setting-title">{NOTICE_KIND_LABEL[kind] === "обычный" ? "Обычный вайп" : "Глобальный вайп"}</div>
                  {img ? <span className="chip success">{Math.round(img.size / 1024)} КБ</span> : <span className="chip danger">не загружена</span>}
                </div>
                {img && (
                  <>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img className="post-image" src={`/api/notices/image/${kind}?v=${img.updatedAt.getTime()}`} alt={`Картинка: ${NOTICE_KIND_LABEL[kind]} вайп`} loading="lazy" style={{ marginTop: 0 }} />
                    <div className="muted" style={{ fontSize: 12 }}>
                      Обновлена {when(img.updatedAt)}
                      {img.updatedByName ? `, ${img.updatedByName}` : ""}
                    </div>
                  </>
                )}
                <ActionForm action={uploadNoticeImage} resetOnSuccess>
                  <input type="hidden" name="kind" value={kind} />
                  <div className="row-actions">
                    <input type="file" name="file" accept="image/png,image/jpeg,image/webp" required aria-label="Файл картинки" style={{ minWidth: 0, flex: 1 }} />
                    <SubmitButton variant="secondary" pendingText="Загружаю…">
                      {img ? "Заменить" : "Загрузить"}
                    </SubmitButton>
                  </div>
                </ActionForm>
              </div>
            );
          })}
        </div>
      </Section>
    </>
  );
}
