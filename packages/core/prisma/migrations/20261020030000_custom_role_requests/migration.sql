-- CreateEnum
CREATE TYPE "CustomRoleRequestStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'EXPIRED');

-- AlterTable
ALTER TABLE "RatingSettings" ADD COLUMN     "approvalChannelId" TEXT,
ADD COLUMN     "customRoleApproval" BOOLEAN NOT NULL DEFAULT true;

-- CreateTable
CREATE TABLE "CustomRoleRequest" (
    "id" SERIAL NOT NULL,
    "purchaseId" INTEGER NOT NULL,
    "memberId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "color" INTEGER,
    "status" "CustomRoleRequestStatus" NOT NULL DEFAULT 'PENDING',
    "channelId" TEXT,
    "messageId" TEXT,
    "decidedById" TEXT,
    "decidedByName" TEXT,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decidedAt" TIMESTAMP(3),

    CONSTRAINT "CustomRoleRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CustomRoleRequest_purchaseId_key" ON "CustomRoleRequest"("purchaseId");

-- CreateIndex
CREATE INDEX "CustomRoleRequest_status_createdAt_idx" ON "CustomRoleRequest"("status", "createdAt");

-- CreateIndex
CREATE INDEX "CustomRoleRequest_memberId_status_idx" ON "CustomRoleRequest"("memberId", "status");

-- AddForeignKey
ALTER TABLE "CustomRoleRequest" ADD CONSTRAINT "CustomRoleRequest_purchaseId_fkey" FOREIGN KEY ("purchaseId") REFERENCES "Purchase"("id") ON DELETE CASCADE ON UPDATE CASCADE;

