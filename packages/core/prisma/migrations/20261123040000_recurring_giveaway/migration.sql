ALTER TABLE "Giveaway"
  ADD COLUMN "repeatEveryDays" INTEGER,
  ADD COLUMN "repeatTimezone" TEXT,
  ADD COLUMN "repeatFromId" INTEGER;

CREATE UNIQUE INDEX "Giveaway_repeatFromId_key" ON "Giveaway"("repeatFromId");

ALTER TABLE "GiveawaySettings" ADD COLUMN "defaultRepeatEveryDays" INTEGER NOT NULL DEFAULT 0;
