import { prisma, type ConnectableBot } from "@flamebot/core";
import { KeyRound, Plug } from "lucide-react";
import { ActionForm, SubmitButton } from "@/components/ActionForm";
import { DangerZone, PageHead, Section } from "@/components/Fields";
import { SecretField } from "@/components/SecretField";
import { clearBotToken, saveBotToken } from "@/app/(panel)/connection/actions";
import { requirePage } from "@/lib/auth";
import { BOT_CONNECTIONS, combinedPermissions, inviteUrl } from "@/lib/botConnection";
import { avatarUrl } from "@/lib/discord";

// Бот отмечается раз в 30 секунд. Дольше двух минут тишины — сервис бота не запущен.
const STALE_MS = 2 * 60_000;

function when(d: Date): string {
  return d.toLocaleString("ru-RU", { dateStyle: "short", timeStyle: "short" });
}

// Раздел «Подключение»: токен Discord вводится здесь, а не в .env. Только для администраторов.
export async function BotConnection({ botKey }: { botKey: ConnectableBot }) {
  await requirePage("full");
  const meta = BOT_CONNECTIONS[botKey];
  const [cred, status, key, others] = await Promise.all([
    prisma.botCredential.findUnique({ where: { botKey } }),
    prisma.botStatus.findUnique({ where: { botKey } }),
    prisma.botPublicKey.findUnique({ where: { botKey } }),
    prisma.botStatus.findMany({ where: { botKey: { in: Object.keys(BOT_CONNECTIONS).filter((k) => k !== botKey) } } }),
  ]);
  // Тот же бот Discord (один токен) у других модулей: покажем это и сложим права в приглашении.
  const sharedWith = status?.discordUserId
    ? others.filter((o) => o.discordUserId === status.discordUserId).map((o) => o.botKey as ConnectableBot)
    : [];
  const permissions = combinedPermissions([botKey, ...sharedWith]);

  const hasToken = !!cred?.discordTokenEnc;
  const alive = !!status && Date.now() - status.heartbeatAt.getTime() < STALE_MS;
  const stateText = !alive
    ? "Сервис бота не запущен или не отвечает"
    : status.state === "running"
      ? "Работает"
      : status.state === "paused"
        ? "Остановлен в панели"
        : (status.loginError ?? "Не смог войти в Discord");

  return (
    <>
      <PageHead
        title="Подключение"
        hint="Токен бота Discord задаётся здесь, а не в .env. Он хранится зашифрованным ключом самого бота: после сохранения его не прочитает ни панель, ни тот, у кого окажется копия базы."
      />

      <Section title="Статус">
        <div className="tiles group">
          <div className="setting">
            {status?.discordUserId ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img className="setting-icon" src={avatarUrl(status.discordUserId, status.discordAvatar)} alt="" width={36} height={36} />
            ) : (
              <div className="setting-icon">
                <Plug size={16} aria-hidden="true" />
              </div>
            )}
            <div className="setting-body">
              <div className="setting-title">{status?.discordUserTag ?? meta.title}</div>
              <div className="setting-hint" style={alive && status.state === "failed" ? { color: "var(--danger)" } : undefined}>
                {stateText}
                {sharedWith.length > 0 && ` · тот же бот Discord, что у: ${sharedWith.map((b) => BOT_CONNECTIONS[b].title.toLowerCase()).join(", ")}`}
              </div>
            </div>
            {status?.discordUserId && (
              <div className="setting-control">
                <a className="btn" href={inviteUrl(status.discordUserId, permissions)} target="_blank" rel="noopener noreferrer">
                  Пригласить на сервер
                </a>
              </div>
            )}
          </div>
          <div className="setting">
            <div className="setting-icon">
              <KeyRound size={16} aria-hidden="true" />
            </div>
            <div className="setting-body">
              <div className="setting-title">Ключ шифрования</div>
              <div className="setting-hint">
                {key
                  ? "Бот передал панели открытый ключ. Приватный ключ хранится только в томе бота."
                  : "Бот ещё ни разу не запускался. Запусти его сервис: без ключа токен сохранить нельзя."}
              </div>
            </div>
          </div>
        </div>
      </Section>

      <Section
        title="Токен бота"
        hint="Developer Portal → приложение бота → Bot → Reset Token. Пока вводишь, токен виден; после сохранения посмотреть его нельзя, только заменить. Перед сохранением панель проверяет токен в Discord."
      >
        <ActionForm
          action={saveBotToken}
          confirm={hasToken ? "Заменить токен?" : undefined}
          confirmMessage={hasToken ? "Бот отключится и войдёт в Discord уже с новым токеном." : undefined}
          confirmLabel="Заменить"
        >
          <input type="hidden" name="botKey" value={botKey} />
          <div className="card" style={{ marginBottom: 0 }}>
            <div className="form-grid">
              <SecretField
                name="discordToken"
                label="Токен Discord"
                placeholder="MTIzNDU2Nzg5MDEyMzQ1Njc4.Gxxxxx.xxxxxxxx"
                saved={hasToken}
                savedAt={cred?.tokenSetAt ? `${when(cred.tokenSetAt)}${cred.tokenSetByName ? `, ${cred.tokenSetByName}` : ""}` : null}
                required
              />
              <div className="muted" style={{ fontSize: 12.5 }}>
                Права для приглашения: {meta.permissionsText}.
                {meta.sharedHint ? ` ${meta.sharedHint}` : ""}
                {meta.intents ? ` В Developer Portal → Bot включи ${meta.intents}.` : " Привилегированные интенты не нужны."}
              </div>
              <div className="form-actions">
                <SubmitButton>Сохранить токен</SubmitButton>
              </div>
            </div>
          </div>
        </ActionForm>
      </Section>

      {hasToken && (
        <DangerZone
          title="Удалить токен"
          action={
            <ActionForm action={clearBotToken} confirm="Удалить токен бота?" confirmMessage="Бот отключится от Discord и будет ждать новый токен." confirmLabel="Удалить" danger>
              <input type="hidden" name="botKey" value={botKey} />
              <SubmitButton variant="danger-solid">Удалить</SubmitButton>
            </ActionForm>
          }
        >
          Бот отключится от Discord. Пригодится, если токен утёк: удали его здесь и создай новый в Developer Portal.
        </DangerZone>
      )}
    </>
  );
}
