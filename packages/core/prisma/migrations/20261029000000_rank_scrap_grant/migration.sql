-- Сколько скрапа за ранги выдано задним числом: повторная выдача даёт только разницу.
ALTER TABLE "Member" ADD COLUMN "rankScrapGranted" INTEGER NOT NULL DEFAULT 0;
