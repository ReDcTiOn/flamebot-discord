-- AlterTable
ALTER TABLE "BotStatus" ADD COLUMN     "state" TEXT NOT NULL DEFAULT 'running';

-- CreateTable
CREATE TABLE "BotControl" (
    "botKey" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "changedById" TEXT,
    "changedByName" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BotControl_pkey" PRIMARY KEY ("botKey")
);

