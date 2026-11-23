import { join } from "node:path";
import { botDataDir, GIVEAWAY_FLAMERUST_KEY_CONTEXT, loadOrCreateBotKey, openSecret, prisma, type BotKey } from "@flamebot/core";

export class GiveawayKeyError extends Error {}

let botKey: BotKey | undefined;

export function getGiveawayBotKey(): BotKey {
  return botKey ??= loadOrCreateBotKey(join(botDataDir(), "secret.key"));
}

export async function loadFlameRustKey(): Promise<string> {
  const saved = await prisma.giveawaySecret.findUnique({
    where: { name: "flamerustApiKey" },
    select: { valueEnc: true },
  });
  if (!saved) throw new GiveawayKeyError("Сохрани API-ключ flamerust.gg в панели: Розыгрыши → Подключение.");
  try {
    return openSecret(getGiveawayBotKey().key, saved.valueEnc, GIVEAWAY_FLAMERUST_KEY_CONTEXT);
  } catch {
    throw new GiveawayKeyError("Не удалось расшифровать API-ключ flamerust.gg. Замени его в панели: Розыгрыши → Подключение.");
  }
}
