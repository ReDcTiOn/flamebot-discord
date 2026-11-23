ALTER TABLE "Giveaway"
  ADD COLUMN "startsAt" TIMESTAMP(3),
  ADD COLUMN "publishRetryAt" TIMESTAMP(3),
  ADD COLUMN "autoPromoAmount" INTEGER,
  ADD COLUMN "autoPromoSeed" TEXT;
