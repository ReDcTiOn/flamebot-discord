-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "ShopItemType" AS ENUM ('ROLE', 'CUSTOM_ROLE', 'BADGE');

-- CreateTable
CREATE TABLE "PanelSettings" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "panelRoleIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PanelSettings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RatingSettings" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "xpMin" INTEGER NOT NULL DEFAULT 15,
    "xpMax" INTEGER NOT NULL DEFAULT 25,
    "xpCooldownSec" INTEGER NOT NULL DEFAULT 60,
    "minMessageLength" INTEGER NOT NULL DEFAULT 5,
    "scrapPerAward" INTEGER NOT NULL DEFAULT 2,
    "voiceXpEnabled" BOOLEAN NOT NULL DEFAULT false,
    "announceRankUp" BOOLEAN NOT NULL DEFAULT true,
    "announceChannelId" TEXT,
    "rankUpMessage" TEXT NOT NULL DEFAULT '{user} дорос до ранга «{rank}» и получает {reward} скрапа',
    "removeOldRankRoles" BOOLEAN NOT NULL DEFAULT true,
    "ignoredChannelIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "commandChannelIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "repCooldownHours" INTEGER NOT NULL DEFAULT 24,
    "repSameTargetDays" INTEGER NOT NULL DEFAULT 7,
    "repMinMemberDays" INTEGER NOT NULL DEFAULT 3,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RatingSettings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Rank" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "emoji" TEXT,
    "minXp" INTEGER NOT NULL,
    "roleId" TEXT,
    "scrapReward" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Rank_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Member" (
    "id" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "avatarHash" TEXT,
    "xp" INTEGER NOT NULL DEFAULT 0,
    "scrap" INTEGER NOT NULL DEFAULT 0,
    "rep" INTEGER NOT NULL DEFAULT 0,
    "messageCount" INTEGER NOT NULL DEFAULT 0,
    "lastXpAt" TIMESTAMP(3),
    "rankId" INTEGER,
    "rewardedUpToXp" INTEGER NOT NULL DEFAULT 0,
    "needsRoleSync" BOOLEAN NOT NULL DEFAULT false,
    "inGuild" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Member_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RepTransaction" (
    "id" SERIAL NOT NULL,
    "giverId" TEXT NOT NULL,
    "receiverId" TEXT NOT NULL,
    "amount" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RepTransaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ShopItem" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "type" "ShopItemType" NOT NULL,
    "price" INTEGER NOT NULL,
    "roleId" TEXT,
    "durationDays" INTEGER,
    "badgeLabel" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "stock" INTEGER,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ShopItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Purchase" (
    "id" SERIAL NOT NULL,
    "memberId" TEXT NOT NULL,
    "itemId" INTEGER NOT NULL,
    "price" INTEGER NOT NULL,
    "roleId" TEXT,
    "customName" TEXT,
    "expiresAt" TIMESTAMP(3),
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Purchase_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MemberBadge" (
    "id" SERIAL NOT NULL,
    "memberId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MemberBadge_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DailyStat" (
    "date" DATE NOT NULL,
    "messages" INTEGER NOT NULL DEFAULT 0,
    "xpAwarded" INTEGER NOT NULL DEFAULT 0,
    "scrapSpent" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "DailyStat_pkey" PRIMARY KEY ("date")
);

-- CreateTable
CREATE TABLE "GuildRole" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "color" INTEGER NOT NULL,
    "position" INTEGER NOT NULL,
    "permissions" TEXT NOT NULL,
    "managed" BOOLEAN NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GuildRole_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GuildChannel" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" INTEGER NOT NULL,
    "position" INTEGER NOT NULL,
    "parentId" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GuildChannel_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GuildInfo" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "name" TEXT NOT NULL,
    "iconHash" TEXT,
    "ownerId" TEXT NOT NULL,
    "memberCount" INTEGER NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GuildInfo_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BotStatus" (
    "botKey" TEXT NOT NULL,
    "heartbeatAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BotStatus_pkey" PRIMARY KEY ("botKey")
);

-- CreateTable
CREATE TABLE "AdminSession" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "avatarHash" TEXT,
    "isGuildAdmin" BOOLEAN NOT NULL,
    "accessTokenEnc" TEXT NOT NULL,
    "ip" TEXT,
    "userAgent" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "lastVerifiedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AdminSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" SERIAL NOT NULL,
    "module" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "actorName" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "target" TEXT,
    "details" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Rank_minXp_key" ON "Rank"("minXp");

-- CreateIndex
CREATE INDEX "Member_xp_idx" ON "Member"("xp" DESC);

-- CreateIndex
CREATE INDEX "Member_rep_idx" ON "Member"("rep" DESC);

-- CreateIndex
CREATE INDEX "Member_scrap_idx" ON "Member"("scrap" DESC);

-- CreateIndex
CREATE INDEX "Member_lastXpAt_idx" ON "Member"("lastXpAt");

-- CreateIndex
CREATE INDEX "Member_needsRoleSync_idx" ON "Member"("needsRoleSync");

-- CreateIndex
CREATE INDEX "RepTransaction_giverId_createdAt_idx" ON "RepTransaction"("giverId", "createdAt");

-- CreateIndex
CREATE INDEX "RepTransaction_giverId_receiverId_createdAt_idx" ON "RepTransaction"("giverId", "receiverId", "createdAt");

-- CreateIndex
CREATE INDEX "Purchase_active_expiresAt_idx" ON "Purchase"("active", "expiresAt");

-- CreateIndex
CREATE INDEX "Purchase_memberId_idx" ON "Purchase"("memberId");

-- CreateIndex
CREATE UNIQUE INDEX "MemberBadge_memberId_label_key" ON "MemberBadge"("memberId", "label");

-- CreateIndex
CREATE INDEX "AdminSession_userId_idx" ON "AdminSession"("userId");

-- CreateIndex
CREATE INDEX "AdminSession_expiresAt_idx" ON "AdminSession"("expiresAt");

-- CreateIndex
CREATE INDEX "AuditLog_createdAt_idx" ON "AuditLog"("createdAt" DESC);

-- CreateIndex
CREATE INDEX "AuditLog_module_createdAt_idx" ON "AuditLog"("module", "createdAt" DESC);

-- AddForeignKey
ALTER TABLE "Member" ADD CONSTRAINT "Member_rankId_fkey" FOREIGN KEY ("rankId") REFERENCES "Rank"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RepTransaction" ADD CONSTRAINT "RepTransaction_giverId_fkey" FOREIGN KEY ("giverId") REFERENCES "Member"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RepTransaction" ADD CONSTRAINT "RepTransaction_receiverId_fkey" FOREIGN KEY ("receiverId") REFERENCES "Member"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Purchase" ADD CONSTRAINT "Purchase_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "Member"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Purchase" ADD CONSTRAINT "Purchase_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "ShopItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MemberBadge" ADD CONSTRAINT "MemberBadge_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "Member"("id") ON DELETE CASCADE ON UPDATE CASCADE;

