-- CreateEnum
CREATE TYPE "OnlineState" AS ENUM ('OFFLINE', 'STARTING', 'ONLINE', 'DISABLED');

-- CreateTable
CREATE TABLE "OnlineSettings" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "pollIntervalMs" INTEGER NOT NULL DEFAULT 5000,
    "connectTimeoutMs" INTEGER NOT NULL DEFAULT 15000,
    "responseTimeoutMs" INTEGER NOT NULL DEFAULT 60000,
    "offlineText" TEXT NOT NULL DEFAULT 'Сервер выключен',
    "startingText" TEXT NOT NULL DEFAULT 'Сервер запускается',
    "onlineText" TEXT NOT NULL DEFAULT 'Онлайн: {players}/{max} игроков',
    "queueText" TEXT NOT NULL DEFAULT 'Онлайн: {players}/{max} ({queued} в очереди)',
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OnlineSettings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OnlineServer" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "host" TEXT NOT NULL,
    "port" INTEGER NOT NULL,
    "rconPasswordEnc" TEXT,
    "discordTokenEnc" TEXT,
    "secretsUpdatedAt" TIMESTAMP(3),
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OnlineServer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OnlineServerStatus" (
    "serverId" INTEGER NOT NULL,
    "state" "OnlineState" NOT NULL DEFAULT 'OFFLINE',
    "players" INTEGER,
    "maxPlayers" INTEGER,
    "queued" INTEGER,
    "botTag" TEXT,
    "botError" TEXT,
    "rconError" TEXT,
    "lastSeenAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OnlineServerStatus_pkey" PRIMARY KEY ("serverId")
);

-- CreateTable
CREATE TABLE "BotPublicKey" (
    "botKey" TEXT NOT NULL,
    "publicKey" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BotPublicKey_pkey" PRIMARY KEY ("botKey")
);

-- AddForeignKey
ALTER TABLE "OnlineServerStatus" ADD CONSTRAINT "OnlineServerStatus_serverId_fkey" FOREIGN KEY ("serverId") REFERENCES "OnlineServer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

