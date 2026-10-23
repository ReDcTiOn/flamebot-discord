-- С какого момента бот работает без перерыва: панель показывает «работает 2 д 4 ч».
ALTER TABLE "BotStatus" ADD COLUMN "startedAt" TIMESTAMP(3);
