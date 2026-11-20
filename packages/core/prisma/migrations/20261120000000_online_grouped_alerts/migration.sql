-- Сводные уведомления онлайна: серверы одного рестарта в одном сообщении.
ALTER TABLE "OnlineServerStatus" ADD COLUMN "downNotifiedAt" TIMESTAMP(3);

-- Раньше «выключился» отправлялся сразу: уже записанные простои считаем отправленными, чтобы не повторить.
UPDATE "OnlineServerStatus" SET "downNotifiedAt" = "downSince" WHERE "alertState" = 'OFFLINE' AND "downSince" IS NOT NULL;

ALTER TABLE "OnlineTelegram"
  ADD COLUMN "groupOfflineText" TEXT NOT NULL DEFAULT '🔴 Выключились {count}',
  ADD COLUMN "groupOnlineText" TEXT NOT NULL DEFAULT '🟢 Снова работают {count}',
  ADD COLUMN "groupOnlineLine" TEXT NOT NULL DEFAULT '• {server} – {downtime} · {players}/{max}',
  ADD COLUMN "groupWaitingText" TEXT NOT NULL DEFAULT '⏳ Пока выключены: {servers}';
