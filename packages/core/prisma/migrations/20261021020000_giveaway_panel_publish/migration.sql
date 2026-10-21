-- AlterTable
ALTER TABLE "Giveaway" ADD COLUMN     "needsPublish" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "publishError" TEXT;

-- CreateIndex
CREATE INDEX "Giveaway_needsPublish_idx" ON "Giveaway"("needsPublish");

