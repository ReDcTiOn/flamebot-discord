-- Токены ботов вводятся в панели и хранятся зашифрованными ключом бота.
CREATE TABLE "BotCredential" (
    "botKey" TEXT NOT NULL,
    "discordTokenEnc" TEXT,
    "tokenSetAt" TIMESTAMP(3),
    "tokenSetById" TEXT,
    "tokenSetByName" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BotCredential_pkey" PRIMARY KEY ("botKey")
);

-- Бот сообщает панели, под каким аккаунтом вошёл в Discord и почему не смог войти.
ALTER TABLE "BotStatus" ADD COLUMN "discordUserId" TEXT,
ADD COLUMN "discordUserTag" TEXT,
ADD COLUMN "discordAvatar" TEXT,
ADD COLUMN "loginError" TEXT;
