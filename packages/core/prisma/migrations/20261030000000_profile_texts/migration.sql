-- Тексты под карточкой в /profile, редактируются в панели.
ALTER TABLE "RatingSettings" ADD COLUMN "profileTexts" JSONB NOT NULL DEFAULT '{}';
