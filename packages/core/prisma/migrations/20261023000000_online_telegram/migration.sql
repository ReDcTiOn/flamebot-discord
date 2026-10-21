-- AlterTable
ALTER TABLE "OnlineServerStatus" ADD COLUMN     "alertState" "OnlineState",
ADD COLUMN     "downSince" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "OnlineTelegram" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "chatIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "notifyOffline" BOOLEAN NOT NULL DEFAULT true,
    "notifyOnline" BOOLEAN NOT NULL DEFAULT true,
    "delaySec" INTEGER NOT NULL DEFAULT 60,
    "offlineText" TEXT NOT NULL DEFAULT '🔴 Сервер {server} выключился',
    "onlineText" TEXT NOT NULL DEFAULT '🟢 Сервер {server} снова работает. Был выключен {downtime}',
    "tokenEnc" TEXT,
    "tokenHint" TEXT,
    "tokenSetAt" TIMESTAMP(3),
    "tokenSetByName" TEXT,
    "botUsername" TEXT,
    "botError" TEXT,
    "testRequestedAt" TIMESTAMP(3),
    "testDoneAt" TIMESTAMP(3),
    "testResult" TEXT,
    "testOk" BOOLEAN,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OnlineTelegram_pkey" PRIMARY KEY ("id")
);
