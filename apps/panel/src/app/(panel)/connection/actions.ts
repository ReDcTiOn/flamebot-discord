"use server";

import { revalidatePath } from "next/cache";
import { CONNECTABLE_BOTS, discordTokenSchema, prisma, sealSecret, tokenContext, type ConnectableBot } from "@flamebot/core";
import { ActionError, audit, runAction, type ActionResult } from "@/lib/auth";
import { BOT_CONNECTIONS } from "@/lib/botConnection";
import { str } from "@/lib/form";

function botParam(fd: FormData): ConnectableBot {
  const key = str(fd, "botKey");
  if (!(CONNECTABLE_BOTS as readonly string[]).includes(key)) throw new ActionError("Неизвестный бот");
  return key as ConnectableBot;
}

// Discord сам говорит, чей это токен. Так неверный токен не попадёт в базу, а панель покажет,
// какого бота подключили. Токен уходит только в API Discord и больше никуда.
async function checkWithDiscord(token: string): Promise<{ id: string; username: string }> {
  let res: Response;
  try {
    res = await fetch("https://discord.com/api/v10/users/@me", {
      headers: { Authorization: `Bot ${token}` },
      cache: "no-store",
      signal: AbortSignal.timeout(8_000),
    });
  } catch {
    throw new ActionError("Не удалось связаться с Discord для проверки токена. Попробуй ещё раз.");
  }
  if (res.status === 401) throw new ActionError("Discord не принял токен. Проверь его или создай новый: Developer Portal → Bot → Reset Token.");
  if (!res.ok) throw new ActionError(`Discord ответил ошибкой ${res.status}. Попробуй ещё раз позже.`);
  const user = (await res.json()) as { id?: string; username?: string; bot?: boolean };
  if (!user.id || !user.bot) throw new ActionError("Это токен не бота. Нужен токен из раздела Bot в Developer Portal.");
  return { id: user.id, username: user.username ?? "бот" };
}

export async function saveBotToken(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  return runAction("full", async (user) => {
    const botKey = botParam(fd);
    const raw = str(fd, "discordToken");
    if (!raw) throw new ActionError("Нажми «Заменить» и вставь новый токен.");
    const token = discordTokenSchema.parse(raw);
    const meta = BOT_CONNECTIONS[botKey];

    const key = await prisma.botPublicKey.findUnique({ where: { botKey } });
    if (!key) throw new ActionError(`${meta.title} ещё ни разу не запускался: запусти его, чтобы панель получила ключ шифрования.`);

    const discordUser = await checkWithDiscord(token);
    // Один бот Discord — один модуль: иначе команды двух модулей затирали бы друг друга.
    const clash = await prisma.botStatus.findFirst({
      where: { discordUserId: discordUser.id, botKey: { not: botKey, in: [...CONNECTABLE_BOTS] } },
    });
    if (clash) {
      const other = BOT_CONNECTIONS[clash.botKey as ConnectableBot]?.title ?? clash.botKey;
      throw new ActionError(`Этот бот уже подключён к модулю «${other}». Каждому модулю нужно своё приложение Discord.`);
    }

    const sealed = sealSecret(key.publicKey, token, tokenContext(botKey));
    const data = { discordTokenEnc: sealed, tokenSetAt: new Date(), tokenSetById: user.id, tokenSetByName: user.username };
    await prisma.botCredential.upsert({ where: { botKey }, create: { botKey, ...data }, update: data });
    // Значение токена в журнал не пишем: только кто и какого бота подключил.
    await audit(user, botKey, "bot.token.set", discordUser.username, { botUserId: discordUser.id });
    revalidatePath(`/${botKey}/connection`);
    return `Токен сохранён. Бот «${discordUser.username}» переподключится в течение 10 секунд.`;
  });
}

export async function clearBotToken(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  return runAction("full", async (user) => {
    const botKey = botParam(fd);
    // Строка остаётся с пустым токеном: так бот не подхватит старый токен из .env заново.
    const data = { discordTokenEnc: null, tokenSetAt: new Date(), tokenSetById: user.id, tokenSetByName: user.username };
    await prisma.botCredential.upsert({ where: { botKey }, create: { botKey, ...data }, update: data });
    await audit(user, botKey, "bot.token.clear", null);
    revalidatePath(`/${botKey}/connection`);
    return "Токен удалён. Бот отключится от Discord в течение 10 секунд.";
  });
}
