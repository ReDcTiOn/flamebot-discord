-- Стартовые настройки опыта — как на FLAME RUST. Меняются только значения по умолчанию
-- для новой базы, уже сохранённые настройки не трогаются.
ALTER TABLE "RatingSettings" ALTER COLUMN "xpMin" SET DEFAULT 0.01,
ALTER COLUMN "xpMax" SET DEFAULT 0.02,
ALTER COLUMN "xpCooldownSec" SET DEFAULT 5,
ALTER COLUMN "scrapPerAward" SET DEFAULT 0.03,
ALTER COLUMN "removeOldRankRoles" SET DEFAULT false;
