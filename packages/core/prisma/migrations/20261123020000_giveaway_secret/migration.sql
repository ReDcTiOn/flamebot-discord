CREATE TABLE "GiveawaySecret" (
    "name" TEXT NOT NULL,
    "valueEnc" TEXT NOT NULL,
    "setAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "setByName" TEXT,

    CONSTRAINT "GiveawaySecret_pkey" PRIMARY KEY ("name")
);
