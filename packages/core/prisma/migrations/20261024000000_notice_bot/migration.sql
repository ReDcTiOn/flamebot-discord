-- CreateTable
CREATE TABLE "NoticeSettings" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "timezone" TEXT NOT NULL DEFAULT 'Europe/Moscow',
    "timezoneLabel" TEXT NOT NULL DEFAULT 'МСК',
    "notifyMinutes" INTEGER NOT NULL DEFAULT 600,
    "remindMinutes" INTEGER NOT NULL DEFAULT 60,
    "maxLateMinutes" INTEGER NOT NULL DEFAULT 30,
    "dryRun" BOOLEAN NOT NULL DEFAULT false,
    "telegramAdminIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "vkGroupId" INTEGER,
    "vkPhotoRegular" TEXT,
    "vkPhotoGlobal" TEXT,
    "testVkGroupId" INTEGER,
    "testVkPhotoRegular" TEXT,
    "testVkPhotoGlobal" TEXT,
    "gamestoresStoreId" TEXT,
    "promoCode" TEXT NOT NULL DEFAULT 'FLAMEWIPE',
    "promoType" TEXT NOT NULL DEFAULT 'discount',
    "promoDaysAfter" INTEGER NOT NULL DEFAULT 1,
    "promoEndTime" TEXT NOT NULL DEFAULT '23:59',
    "promoLimitUses" INTEGER NOT NULL DEFAULT 0,
    "promoTestReal" BOOLEAN NOT NULL DEFAULT false,
    "agendaEnabled" BOOLEAN NOT NULL DEFAULT true,
    "agendaSendAt" TEXT NOT NULL DEFAULT '05:00',
    "agendaGraceMinutes" INTEGER NOT NULL DEFAULT 240,
    "agendaGreeting" TEXT NOT NULL DEFAULT 'Доброе утро!',
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NoticeSettings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NoticeSecret" (
    "name" TEXT NOT NULL,
    "valueEnc" TEXT NOT NULL,
    "hint" TEXT,
    "setAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "setById" TEXT,
    "setByName" TEXT,

    CONSTRAINT "NoticeSecret_pkey" PRIMARY KEY ("name")
);

-- CreateTable
CREATE TABLE "NoticeTemplate" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "discord" JSONB NOT NULL,
    "vk" TEXT NOT NULL,
    "promoAmount" INTEGER,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NoticeTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NoticeRule" (
    "key" TEXT NOT NULL,
    "weekday" INTEGER NOT NULL,
    "time" TEXT NOT NULL,
    "forceTimezone" TEXT,
    "forceTime" TEXT,
    "bpFirstOfMonth" BOOLEAN NOT NULL DEFAULT false,
    "bpEveryDays" INTEGER NOT NULL DEFAULT 0,
    "bpAnchor" DATE,
    "regularTemplateId" TEXT,
    "globalTemplateId" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NoticeRule_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "NoticeEvent" (
    "key" TEXT NOT NULL,
    "wipeAt" TIMESTAMP(3) NOT NULL,
    "kind" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "confirmed" BOOLEAN NOT NULL DEFAULT false,
    "confirmedBy" TEXT,
    "notified" BOOLEAN NOT NULL DEFAULT false,
    "reminded" BOOLEAN NOT NULL DEFAULT false,
    "isTest" BOOLEAN NOT NULL DEFAULT false,
    "results" JSONB NOT NULL DEFAULT '{}',
    "msgs" JSONB NOT NULL DEFAULT '[]',
    "promo" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NoticeEvent_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "NoticeAgendaDay" (
    "weekday" INTEGER NOT NULL,
    "items" TEXT[],

    CONSTRAINT "NoticeAgendaDay_pkey" PRIMARY KEY ("weekday")
);

-- CreateTable
CREATE TABLE "NoticeReminder" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "button" TEXT NOT NULL DEFAULT '✅ Готово',
    "doneText" TEXT NOT NULL DEFAULT 'Больше сегодня не напомню.',
    "days" INTEGER[],
    "times" TEXT[],
    "graceMinutes" INTEGER NOT NULL DEFAULT 60,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NoticeReminder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NoticeDaily" (
    "key" TEXT NOT NULL,
    "data" JSONB NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NoticeDaily_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "NoticeImage" (
    "kind" TEXT NOT NULL,
    "data" BYTEA NOT NULL,
    "mime" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedByName" TEXT,

    CONSTRAINT "NoticeImage_pkey" PRIMARY KEY ("kind")
);

-- CreateTable
CREATE TABLE "NoticeAction" (
    "id" SERIAL NOT NULL,
    "kind" TEXT NOT NULL,
    "args" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "result" TEXT,
    "details" JSONB,
    "byId" TEXT,
    "byName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "doneAt" TIMESTAMP(3),

    CONSTRAINT "NoticeAction_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "NoticeEvent_status_wipeAt_idx" ON "NoticeEvent"("status", "wipeAt");

-- CreateIndex
CREATE INDEX "NoticeEvent_wipeAt_idx" ON "NoticeEvent"("wipeAt" DESC);

-- CreateIndex
CREATE INDEX "NoticeAction_status_id_idx" ON "NoticeAction"("status", "id");

