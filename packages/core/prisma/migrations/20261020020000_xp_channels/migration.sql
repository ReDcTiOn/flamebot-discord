-- Список «каналы без опыта» заменён на список «каналы, где начисляется опыт».
-- Пустой список, как и раньше, означает: опыт начисляется везде.

-- AlterTable
ALTER TABLE "RatingSettings" ADD COLUMN "xpChannelIds" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- Переносим старую настройку: если какие-то каналы были исключены, опыт включаем
-- во всех остальных текстовых каналах (текстовые, новости, форумы) из снимка сервера.
UPDATE "RatingSettings"
SET "xpChannelIds" = COALESCE(
  (
    SELECT array_agg(c."id" ORDER BY c."position", c."name")
    FROM "GuildChannel" c
    WHERE c."type" IN (0, 5, 15) AND NOT (c."id" = ANY ("RatingSettings"."ignoredChannelIds"))
  ),
  ARRAY[]::TEXT[]
)
WHERE cardinality("ignoredChannelIds") > 0;

-- AlterTable
ALTER TABLE "RatingSettings" DROP COLUMN "ignoredChannelIds";
