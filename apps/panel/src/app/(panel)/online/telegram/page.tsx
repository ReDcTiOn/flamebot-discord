import { prisma } from "@flamebot/core";
import { ActionForm, SubmitButton } from "@/components/ActionForm";
import { FieldRow, NumberInput, PageHead, Section, Switch } from "@/components/Fields";
import { SecretField } from "@/components/SecretField";
import { requirePage } from "@/lib/auth";
import { clearOnlineTelegramToken, saveOnlineTelegram, saveOnlineTelegramToken, testOnlineTelegram } from "../actions";

export const metadata = { title: "Уведомления в Telegram" };

const W = { width: 320 };
const TEXT = { width: 460 };
const when = (d: Date) => d.toLocaleString("ru-RU", { dateStyle: "short", timeStyle: "short" });

export default async function OnlineTelegramPage() {
  const user = await requirePage();
  const [t, key] = await Promise.all([
    prisma.onlineTelegram.upsert({ where: { id: 1 }, update: {}, create: { id: 1 } }),
    prisma.botPublicKey.findUnique({ where: { botKey: "online" } }),
  ]);
  const full = user.level === "full";

  return (
    <>
      <PageHead title="Telegram" hint="Бот присылает в Telegram сообщение, когда сервер выключился и когда снова заработал." />

      {!t.tokenEnc ? (
        <p className="notice warn">
          Бот Telegram не подключён.{" "}
          {full ? "Создай бота в @BotFather и вставь его токен ниже." : "Подключить его может администратор сервера."}
        </p>
      ) : t.botError ? (
        <p className="notice warn">{t.botError}</p>
      ) : t.botUsername ? (
        <p className="notice">
          Подключён бот <b>@{t.botUsername}</b>. Напиши ему <code>/id</code> в личке или в группе, где он состоит, и он пришлёт ID чата для списка получателей.
        </p>
      ) : (
        <p className="notice">Бот онлайна подключается к Telegram…</p>
      )}

      <ActionForm action={saveOnlineTelegram}>
        <Section title="Получатели" hint="Кому слать уведомления. Пользователь должен сначала написать боту /start, а в группу или канал бота нужно добавить.">
          <div className="tiles group">
            <FieldRow icon="users" label="Чаты" hint="ID через запятую или с новой строки: пользователь — 123456789, группа — -1001234567890, публичный канал — @name">
              <textarea name="chatIds" defaultValue={t.chatIds.join("\n")} rows={3} maxLength={1000} style={W} placeholder={"123456789\n-1001234567890"} aria-label="Чаты Telegram" />
            </FieldRow>
          </div>
        </Section>

        <Section title="Уведомления" hint="Подстановки: {server} — название сервера; в сообщении о включении ещё {downtime} — сколько не работал, {players} и {max} — онлайн и слоты.">
          <div className="tiles group">
            <FieldRow icon="server" label="Сервер выключился">
              <Switch name="notifyOffline" defaultChecked={t.notifyOffline} label="Сообщать о выключении" />
            </FieldRow>
            <FieldRow icon="message" label="Текст о выключении">
              <input type="text" name="offlineText" defaultValue={t.offlineText} maxLength={1000} required style={TEXT} />
            </FieldRow>
            <FieldRow icon="activity" label="Сервер снова работает" hint="Если сервер не работал дольше времени ожидания">
              <Switch name="notifyOnline" defaultChecked={t.notifyOnline} label="Сообщать о включении" />
            </FieldRow>
            <FieldRow icon="message" label="Текст о включении">
              <input type="text" name="onlineText" defaultValue={t.onlineText} maxLength={1000} required style={TEXT} />
            </FieldRow>
            <FieldRow icon="clock" label="Ждать перед тревогой, секунд" hint="Сервер должен не отвечать столько времени подряд: короткий обрыв связи не повод писать">
              <NumberInput name="delaySec" defaultValue={t.delaySec} min={0} max={3600} label="Ждать перед тревогой" />
            </FieldRow>
          </div>
        </Section>

        <div className="save-bar">
          <SubmitButton>Сохранить</SubmitButton>
        </div>
      </ActionForm>

      <Section
        title="Проверка связи"
        hint="Бот отправит пробное сообщение всем получателям из сохранённого списка."
        action={
          <ActionForm action={testOnlineTelegram}>
            <SubmitButton variant="secondary" pendingText="Отправляю…">
              Отправить пробное
            </SubmitButton>
          </ActionForm>
        }
      >
        {t.testDoneAt ? (
          <p className={t.testOk ? "notice" : "notice warn"}>
            {when(t.testDoneAt)}: {t.testResult}
          </p>
        ) : (
          <p className="muted" style={{ fontSize: 12.5 }}>Проверок ещё не было.</p>
        )}
      </Section>

      {full && (
        <Section title="Подключение" hint="Токен шифруется ключом бота онлайна сразу при сохранении: посмотреть его нельзя, только заменить. Нужен отдельный бот, не тот, что у бота карт.">
          {!key && <p className="notice warn">Бот онлайна ещё ни разу не запускался, поэтому ключа шифрования нет. Запусти сервис online-bot.</p>}
          <ActionForm action={saveOnlineTelegramToken}>
            <div className="setting" style={{ flexDirection: "column", alignItems: "stretch", gap: 6 }}>
              {/* key: после сохранения поле пересоздаётся и показывает «Сохранён» вместо введённого токена. */}
              <SecretField
                key={t.tokenSetAt?.toISOString() ?? "none"}
                name="telegramToken"
                label="Токен бота Telegram"
                placeholder="123456789:AA… от @BotFather"
                saved={!!t.tokenEnc}
                savedAt={t.tokenSetAt ? `${when(t.tokenSetAt)}, ${t.tokenSetByName ?? "?"}` : null}
                required
              />
              {t.tokenHint && <div className="muted" style={{ fontSize: 12 }}>Сохранено: {t.tokenHint}</div>}
            </div>
            <div className="save-bar" style={{ gap: 8 }}>
              {t.tokenEnc && (
                <button type="submit" form="online-telegram-clear" className="btn danger">
                  Отключить
                </button>
              )}
              <SubmitButton>Сохранить токен</SubmitButton>
            </div>
          </ActionForm>
          <ActionForm id="online-telegram-clear" action={clearOnlineTelegramToken} confirm="Отключить уведомления в Telegram?" confirmMessage="Токен удалится, бот перестанет присылать уведомления." confirmLabel="Отключить" danger />
        </Section>
      )}
    </>
  );
}
