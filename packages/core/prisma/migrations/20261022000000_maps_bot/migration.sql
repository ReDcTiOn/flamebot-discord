-- CreateTable
CREATE TABLE "MapsSettings" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "timezone" TEXT NOT NULL DEFAULT 'Europe/Moscow',
    "timezoneLabel" TEXT NOT NULL DEFAULT 'МСК',
    "sendLeadHours" DOUBLE PRECISION NOT NULL DEFAULT 24,
    "genLeadHours" DOUBLE PRECISION NOT NULL DEFAULT 10,
    "autoPick" BOOLEAN NOT NULL DEFAULT false,
    "panelAskHours" INTEGER NOT NULL DEFAULT 8,
    "panelRemindMinutes" INTEGER NOT NULL DEFAULT 60,
    "panelAutoMinutes" INTEGER NOT NULL DEFAULT 30,
    "telegramAdminIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "telegramChatId" TEXT,
    "rustmapsOrgId" TEXT,
    "s3Endpoint" TEXT NOT NULL DEFAULT '',
    "s3Region" TEXT NOT NULL DEFAULT '',
    "s3Bucket" TEXT NOT NULL DEFAULT '',
    "s3Prefix" TEXT NOT NULL DEFAULT 'maps',
    "s3Addressing" TEXT NOT NULL DEFAULT 'path',
    "cdnBaseUrl" TEXT NOT NULL DEFAULT '',
    "pteroUrl" TEXT,
    "scoring" JSONB,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MapsSettings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MapsSecret" (
    "name" TEXT NOT NULL,
    "valueEnc" TEXT NOT NULL,
    "hint" TEXT,
    "setAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "setById" TEXT,
    "setByName" TEXT,

    CONSTRAINT "MapsSecret_pkey" PRIMARY KEY ("name")
);

-- CreateTable
CREATE TABLE "MapsServer" (
    "id" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "folder" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "savedConfig" TEXT NOT NULL,
    "pteroUuid" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MapsServer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MapsWipeRule" (
    "key" TEXT NOT NULL,
    "weekday" INTEGER NOT NULL,
    "time" TEXT NOT NULL,
    "serverIds" INTEGER[],
    "pool" JSONB NOT NULL,
    "template" JSONB NOT NULL,
    "forceTimezone" TEXT,
    "forceTime" TEXT,
    "bpFirstOfMonth" BOOLEAN NOT NULL DEFAULT false,
    "bpEveryDays" INTEGER NOT NULL DEFAULT 0,
    "bpAnchor" DATE,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MapsWipeRule_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "MapsCycle" (
    "id" TEXT NOT NULL,
    "ruleKey" TEXT NOT NULL,
    "wipeAt" TIMESTAMP(3) NOT NULL,
    "sendAt" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL,
    "staging" BOOLEAN NOT NULL DEFAULT false,
    "blueprints" BOOLEAN NOT NULL DEFAULT false,
    "warned" BOOLEAN NOT NULL DEFAULT false,
    "autoMode" BOOLEAN NOT NULL DEFAULT false,
    "autoMsgId" INTEGER,
    "promptMsgId" INTEGER,
    "panelState" TEXT NOT NULL DEFAULT 'idle',
    "panelMsgId" INTEGER,
    "panelNotifiedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MapsCycle_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MapsSlot" (
    "id" SERIAL NOT NULL,
    "cycleId" TEXT NOT NULL,
    "serverId" INTEGER NOT NULL,
    "size" INTEGER NOT NULL,
    "config" TEXT NOT NULL,
    "attempt" INTEGER NOT NULL DEFAULT 1,
    "seed" INTEGER,
    "rmMapId" TEXT,
    "status" TEXT NOT NULL,
    "info" JSONB,
    "viewUrl" TEXT,
    "s3Key" TEXT,
    "cdnUrl" TEXT,
    "error" TEXT,
    "source" TEXT NOT NULL DEFAULT 'rustmaps',
    "candId" INTEGER,
    "tgMsgId" INTEGER,
    "tgPhotoMsgId" INTEGER,
    "panelSynced" BOOLEAN NOT NULL DEFAULT false,
    "panelNote" TEXT,

    CONSTRAINT "MapsSlot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MapsCandidate" (
    "id" SERIAL NOT NULL,
    "cycleId" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "config" TEXT NOT NULL,
    "seed" INTEGER,
    "rmMapId" TEXT,
    "status" TEXT NOT NULL,
    "info" JSONB,
    "viewUrl" TEXT,
    "error" TEXT,
    "slotId" INTEGER,
    "rejectedOrder" INTEGER,
    "parkedOrder" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MapsCandidate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MapsAction" (
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

    CONSTRAINT "MapsAction_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MapsCycle_status_idx" ON "MapsCycle"("status");

-- CreateIndex
CREATE INDEX "MapsCycle_wipeAt_idx" ON "MapsCycle"("wipeAt");

-- CreateIndex
CREATE INDEX "MapsSlot_cycleId_idx" ON "MapsSlot"("cycleId");

-- CreateIndex
CREATE INDEX "MapsSlot_status_idx" ON "MapsSlot"("status");

-- CreateIndex
CREATE INDEX "MapsCandidate_cycleId_size_config_status_idx" ON "MapsCandidate"("cycleId", "size", "config", "status");

-- CreateIndex
CREATE INDEX "MapsCandidate_status_idx" ON "MapsCandidate"("status");

-- CreateIndex
CREATE INDEX "MapsAction_status_id_idx" ON "MapsAction"("status", "id");

-- AddForeignKey
ALTER TABLE "MapsSlot" ADD CONSTRAINT "MapsSlot_cycleId_fkey" FOREIGN KEY ("cycleId") REFERENCES "MapsCycle"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MapsCandidate" ADD CONSTRAINT "MapsCandidate_cycleId_fkey" FOREIGN KEY ("cycleId") REFERENCES "MapsCycle"("id") ON DELETE CASCADE ON UPDATE CASCADE;

