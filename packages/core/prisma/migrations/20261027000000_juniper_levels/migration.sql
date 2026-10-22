-- Рейтинг как в JuniperBot: уровни, 15–24 опыта за сообщение раз в минуту, опыт за голос.

-- Начисление за сообщения и голос.
ALTER TABLE "RatingSettings"
  ALTER COLUMN "xpMin" SET DEFAULT 15,
  ALTER COLUMN "xpMax" SET DEFAULT 24,
  ALTER COLUMN "xpCooldownSec" SET DEFAULT 60,
  ALTER COLUMN "voiceXpEnabled" SET DEFAULT true,
  ADD COLUMN "voiceXpPerMember" INTEGER NOT NULL DEFAULT 6;
UPDATE "RatingSettings" SET "xpMin" = 15, "xpMax" = 24, "xpCooldownSec" = 60, "voiceXpEnabled" = true;

-- Ранги задаются уровнем. Временные уровни по порядку: 5, 10, 15, … — их поправляют в панели.
-- Порог опыта — опыт уровня по формуле JuniperBot. Свои ставки опыта у рангов сбрасываются, скрап остаётся.
ALTER TABLE "Rank" ADD COLUMN "minLevel" INTEGER;
CREATE TEMP TABLE rank_map AS
  SELECT id, "minXp" AS old_min, (5 * row_number() OVER (ORDER BY "minXp"))::int AS lvl FROM "Rank";
ALTER TABLE rank_map ADD COLUMN new_min INTEGER;
UPDATE rank_map SET new_min = (5 * (lvl - 1) * lvl * (2 * lvl - 1)) / 6 + (50 * (lvl - 1) * lvl) / 2 + 100 * lvl;

-- Награды за ранги, уже полученные участниками, переводим в новый масштаб: повторно скрап не начислится.
UPDATE "Member" m SET "rewardedUpToXp" = COALESCE(
  (SELECT r.new_min FROM rank_map r WHERE r.old_min <= m."rewardedUpToXp" AND m."rewardedUpToXp" > 0 ORDER BY r.old_min DESC LIMIT 1),
  0);

-- Через временные отрицательные значения, чтобы не задеть уникальность порогов при обновлении.
UPDATE "Rank" SET "minXp" = -id;
UPDATE "Rank" r SET "minLevel" = m.lvl, "minXp" = m.new_min, "xpMin" = NULL, "xpMax" = NULL FROM rank_map m WHERE m.id = r.id;
ALTER TABLE "Rank" ALTER COLUMN "minLevel" SET NOT NULL;
CREATE UNIQUE INDEX "Rank_minLevel_key" ON "Rank"("minLevel");
DROP TABLE rank_map;

-- Опыт в прежнем масштабе (сотые доли за сообщение) почти нулевой. Бот проверит всех на сервере
-- и поднимет опыт до порога роли ранга, которая у человека уже есть, — все останутся при своих ролях.
UPDATE "Member" SET "needsMemberCheck" = true WHERE "inGuild";
