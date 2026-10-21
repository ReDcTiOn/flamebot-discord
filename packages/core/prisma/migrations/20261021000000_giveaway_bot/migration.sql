-- CreateEnum
CREATE TYPE "GiveawayStatus" AS ENUM ('ACTIVE', 'ENDED', 'CANCELLED');

-- CreateTable
CREATE TABLE "GiveawaySettings" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "timezone" TEXT NOT NULL DEFAULT 'Asia/Vladivostok',
    "timezoneLabel" TEXT NOT NULL DEFAULT 'Владивосток',
    "promoDmText" TEXT NOT NULL DEFAULT 'Привет!
Ты победил в розыгрыше **«{prize}»** в дискорд канале **[FlameRust](https://discord.flamerust.ru)**!

**Твой промокод: {code}**

Активировать его можно на нашем сайте [FlameRust.GG](https://flamerust.gg) в профиле.
Срок действия промокода: 1 неделя

Спасибо что играешь на наших серверах!',
    "quickPrize" TEXT NOT NULL DEFAULT 'Промокод на 50 рублей',
    "quickWinners" INTEGER NOT NULL DEFAULT 5,
    "quickDaysAhead" INTEGER NOT NULL DEFAULT 1,
    "quickTime" TEXT NOT NULL DEFAULT '23:00',
    "quickBoostersOnly" BOOLEAN NOT NULL DEFAULT false,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GiveawaySettings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Giveaway" (
    "id" SERIAL NOT NULL,
    "channelId" TEXT NOT NULL,
    "messageId" TEXT,
    "hostId" TEXT NOT NULL,
    "prize" TEXT NOT NULL,
    "description" TEXT,
    "winnersCount" INTEGER NOT NULL,
    "endsAt" TIMESTAMP(3) NOT NULL,
    "boostersOnly" BOOLEAN NOT NULL DEFAULT false,
    "status" "GiveawayStatus" NOT NULL DEFAULT 'ACTIVE',
    "winners" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "needsMessageUpdate" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Giveaway_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GiveawayEntry" (
    "giveawayId" INTEGER NOT NULL,
    "userId" TEXT NOT NULL,
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GiveawayEntry_pkey" PRIMARY KEY ("giveawayId","userId")
);

-- CreateTable
CREATE TABLE "GiveawayPromoCode" (
    "id" SERIAL NOT NULL,
    "giveawayId" INTEGER NOT NULL,
    "code" TEXT NOT NULL,
    "userId" TEXT,
    "dmSent" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "GiveawayPromoCode_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Giveaway_messageId_key" ON "Giveaway"("messageId");

-- CreateIndex
CREATE INDEX "Giveaway_status_endsAt_idx" ON "Giveaway"("status", "endsAt");

-- CreateIndex
CREATE INDEX "Giveaway_needsMessageUpdate_idx" ON "Giveaway"("needsMessageUpdate");

-- CreateIndex
CREATE INDEX "GiveawayPromoCode_giveawayId_idx" ON "GiveawayPromoCode"("giveawayId");

-- AddForeignKey
ALTER TABLE "GiveawayEntry" ADD CONSTRAINT "GiveawayEntry_giveawayId_fkey" FOREIGN KEY ("giveawayId") REFERENCES "Giveaway"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GiveawayPromoCode" ADD CONSTRAINT "GiveawayPromoCode_giveawayId_fkey" FOREIGN KEY ("giveawayId") REFERENCES "Giveaway"("id") ON DELETE CASCADE ON UPDATE CASCADE;

