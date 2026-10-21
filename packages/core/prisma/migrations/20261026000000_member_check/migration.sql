-- AlterTable
ALTER TABLE "Member" ADD COLUMN     "needsMemberCheck" BOOLEAN NOT NULL DEFAULT false;

-- CreateIndex
CREATE INDEX "Member_needsMemberCheck_idx" ON "Member"("needsMemberCheck");

