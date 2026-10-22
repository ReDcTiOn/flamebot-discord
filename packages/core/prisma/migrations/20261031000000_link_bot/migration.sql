-- Привязка Steam к Discord: настройки, привязки, коды из игры, серверы с ключами API, задания из панели.

-- CreateTable
CREATE TABLE "LinkSettings" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "channelId" TEXT,
    "roleId" TEXT,
    "codeTtlMinutes" INTEGER NOT NULL DEFAULT 10,
    "panelTitle" TEXT NOT NULL DEFAULT 'Привязка аккаунта Steam',
    "panelText" TEXT NOT NULL DEFAULT 'Свяжи свой Steam с Discord, чтобы получить роль игрока.

**1.** Зайди на любой наш сервер RUST и напиши в чат **/connect**.
**2.** Нажми кнопку «Привязать» ниже и введи код из игры.

Один Discord можно привязать только к одному аккаунту Steam.',
    "buttonLabel" TEXT NOT NULL DEFAULT 'Привязать',
    "messageChannelId" TEXT,
    "messageId" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LinkSettings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SteamLink" (
    "discordId" TEXT NOT NULL,
    "steamId" TEXT NOT NULL,
    "steamName" TEXT NOT NULL,
    "discordName" TEXT NOT NULL,
    "serverId" INTEGER,
    "linkedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "inGuild" BOOLEAN NOT NULL DEFAULT true,
    "checkedAt" TIMESTAMP(3),

    CONSTRAINT "SteamLink_pkey" PRIMARY KEY ("discordId")
);

-- CreateTable
CREATE TABLE "LinkCode" (
    "code" TEXT NOT NULL,
    "steamId" TEXT NOT NULL,
    "steamName" TEXT NOT NULL,
    "serverId" INTEGER,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LinkCode_pkey" PRIMARY KEY ("code")
);

-- CreateTable
CREATE TABLE "LinkServer" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "keyHash" TEXT NOT NULL,
    "keyHint" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3),

    CONSTRAINT "LinkServer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LinkAction" (
    "id" SERIAL NOT NULL,
    "kind" TEXT NOT NULL,
    "discordId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "doneAt" TIMESTAMP(3),

    CONSTRAINT "LinkAction_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SteamLink_steamId_key" ON "SteamLink"("steamId");

-- CreateIndex
CREATE INDEX "SteamLink_linkedAt_idx" ON "SteamLink"("linkedAt" DESC);

-- CreateIndex
CREATE INDEX "SteamLink_checkedAt_idx" ON "SteamLink"("checkedAt");

-- CreateIndex
CREATE UNIQUE INDEX "LinkCode_steamId_key" ON "LinkCode"("steamId");

-- CreateIndex
CREATE INDEX "LinkCode_expiresAt_idx" ON "LinkCode"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "LinkServer_keyHash_key" ON "LinkServer"("keyHash");

-- CreateIndex
CREATE INDEX "LinkAction_doneAt_idx" ON "LinkAction"("doneAt");

-- AddForeignKey
ALTER TABLE "SteamLink" ADD CONSTRAINT "SteamLink_serverId_fkey" FOREIGN KEY ("serverId") REFERENCES "LinkServer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

