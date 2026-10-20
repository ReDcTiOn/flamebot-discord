-- CreateEnum
CREATE TYPE "EventLevel" AS ENUM ('INFO', 'WARN', 'ERROR');

-- CreateTable
CREATE TABLE "BotEvent" (
    "id" SERIAL NOT NULL,
    "botKey" TEXT NOT NULL,
    "level" "EventLevel" NOT NULL DEFAULT 'INFO',
    "type" TEXT NOT NULL,
    "memberId" TEXT,
    "message" TEXT NOT NULL,
    "details" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BotEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "BotEvent_createdAt_idx" ON "BotEvent"("createdAt" DESC);

-- CreateIndex
CREATE INDEX "BotEvent_botKey_level_createdAt_idx" ON "BotEvent"("botKey", "level", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "BotEvent_memberId_createdAt_idx" ON "BotEvent"("memberId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "BotEvent_type_idx" ON "BotEvent"("type");

