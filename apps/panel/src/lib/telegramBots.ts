import { prisma } from "@flamebot/core";

// Один Telegram-бот можно подключить только к одному модулю: два процесса, читающие его сообщения,
// отбирают друг у друга нажатия кнопок. Токены зашифрованы, поэтому сравниваем номер бота из подсказки.

type Module = "maps" | "online" | "notices";
const LABEL: Record<Module, string> = { maps: "бот карт", online: "уведомления об онлайне серверов", notices: "бот объявлений о вайпах" };

const botId = (v: string | null | undefined) => v?.match(/\d{5,15}/)?.[0] ?? null;

// Какой другой модуль уже использует этого Telegram-бота; null — никакой.
export async function telegramBotTakenBy(token: string, except: Module): Promise<string | null> {
  const id = botId(token.split(":")[0]);
  if (!id) return null;
  const [maps, online, notices] = await Promise.all([
    prisma.mapsSecret.findUnique({ where: { name: "telegramToken" }, select: { hint: true } }),
    prisma.onlineTelegram.findUnique({ where: { id: 1 }, select: { tokenHint: true } }),
    prisma.noticeSecret.findUnique({ where: { name: "telegramToken" }, select: { hint: true } }),
  ]);
  const used: [Module, string | null | undefined][] = [
    ["maps", maps?.hint],
    ["online", online?.tokenHint],
    ["notices", notices?.hint],
  ];
  const hit = used.find(([m, hint]) => m !== except && botId(hint) === id);
  return hit ? LABEL[hit[0]] : null;
}
