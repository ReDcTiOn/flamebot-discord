-- Сохранённые варианты карточки профиля.
CREATE TABLE "CardPreset" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "layout" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CardPreset_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CardPreset_name_key" ON "CardPreset"("name");

-- Скрап в объявлении о ранге — эмодзи сервера вместо слова. Свой текст администратора не трогаем.
ALTER TABLE "RatingSettings" ALTER COLUMN "rankUpMessage" SET DEFAULT '{user} дорос до ранга «{rank}» и получает {reward} {scrap_icon}';
UPDATE "RatingSettings" SET "rankUpMessage" = '{user} дорос до ранга «{rank}» и получает {reward} {scrap_icon}'
WHERE "rankUpMessage" = '{user} дорос до ранга «{rank}» и получает {reward} скрапа';
