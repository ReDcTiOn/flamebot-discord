-- AlterTable
ALTER TABLE "RatingSettings" ADD COLUMN     "profileCardEnabled" BOOLEAN NOT NULL DEFAULT true;

-- CreateTable
CREATE TABLE "ProfileCard" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "layout" JSONB NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProfileCard_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CardAsset" (
    "id" SERIAL NOT NULL,
    "mime" TEXT NOT NULL,
    "width" INTEGER NOT NULL,
    "height" INTEGER NOT NULL,
    "size" INTEGER NOT NULL,
    "data" BYTEA NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CardAsset_pkey" PRIMARY KEY ("id")
);

