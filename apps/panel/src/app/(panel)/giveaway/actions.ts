"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import {
  GIVEAWAY_MAX_DAYS,
  GIVEAWAY_MAX_WINNERS,
  formatInZone,
  getGiveawaySettings,
  giveawaySettingsSchema,
  parseCodes,
  parseTime,
  prisma,
  promoCodesProblem,
  snowflake,
  zonedToDate,
} from "@flamebot/core";
import { ActionError, audit, runAction, type ActionResult } from "@/lib/auth";
import { bool, idParam, int, str } from "@/lib/form";

const MODULE = "giveaway";

const draftSchema = z.object({
  prize: z.string().trim().min(1, "Укажи приз").max(200, "Приз — не больше 200 символов"),
  winners: z.number().int().min(1, "Победителей — от 1").max(GIVEAWAY_MAX_WINNERS, `Победителей — не больше ${GIVEAWAY_MAX_WINNERS}`),
  description: z.string().trim().max(1000, "Описание — не больше 1000 символов"),
  channelId: snowflake,
  boostersOnly: z.boolean(),
});

// Создание розыгрыша из панели. У панели нет токена бота, поэтому она только записывает
// розыгрыш в базу, а сообщение с кнопкой «Участвовать» отправляет бот в течение 10 секунд.
export async function createGiveaway(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  return runAction("any", async (user) => {
    const s = await getGiveawaySettings(prisma);
    const d = draftSchema.parse({
      prize: str(fd, "prize"),
      winners: int(fd, "winners"),
      description: str(fd, "description"),
      channelId: str(fd, "channelId"),
      boostersOnly: bool(fd, "boostersOnly"),
    });
    // Только текстовые и новостные каналы: в форум бот розыгрыш не отправит.
    const channel = await prisma.guildChannel.findFirst({ where: { id: d.channelId, type: { in: [0, 5] } } });
    if (!channel) throw new ActionError("Выбери текстовый канал из списка");

    const date = /^(\d{4})-(\d{2})-(\d{2})$/.exec(str(fd, "date"));
    const time = parseTime(str(fd, "time"));
    if (!date) throw new ActionError("Укажи дату итогов");
    if (!time) throw new ActionError("Укажи время итогов в формате ЧЧ:ММ");
    const endsAt = zonedToDate({ year: Number(date[1]), month: Number(date[2]), day: Number(date[3]) }, time, s.timezone);
    const now = Date.now();
    if (endsAt.getTime() <= now + 60_000) {
      throw new ActionError(`Время итогов должно быть в будущем. Сейчас ${formatInZone(new Date(now), s.timezone)} (${s.timezoneLabel}).`);
    }
    if (endsAt.getTime() - now > GIVEAWAY_MAX_DAYS * 86_400_000) throw new ActionError("Розыгрыш не может длиться дольше года.");

    // Промокоды необязательны: пустое поле — розыгрыш без промокодов.
    const codes = parseCodes(str(fd, "codes"));
    const problem = codes.length > 0 ? promoCodesProblem(codes, d.winners) : null;
    if (problem) throw new ActionError(problem);

    const g = await prisma.giveaway.create({
      data: {
        channelId: d.channelId,
        hostId: user.id,
        prize: d.prize,
        description: d.description || null,
        winnersCount: d.winners,
        endsAt,
        boostersOnly: d.boostersOnly,
        needsPublish: true,
        promoCodes: { create: codes.map((code) => ({ code })) },
      },
    });
    // Сами промокоды в журнал не пишем: его видят все, у кого есть доступ к панели.
    await audit(user, MODULE, "giveaway.create", `#${g.id} ${g.prize}`, {
      channelId: d.channelId,
      winners: d.winners,
      endsAt: endsAt.toISOString(),
      boostersOnly: d.boostersOnly,
      promoCodes: codes.length,
    });
    revalidatePath("/giveaway", "layout");
    return `Розыгрыш #${g.id} создан. Бот отправит его в #${channel.name} в течение 10 секунд, если он запущен.`;
  });
}

export async function saveGiveawaySettings(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  return runAction("any", async (user) => {
    const data = giveawaySettingsSchema.parse({
      timezone: str(fd, "timezone"),
      timezoneLabel: str(fd, "timezoneLabel"),
      // Переводы строк из браузера приходят как \r\n, в Discord они не нужны.
      promoDmText: str(fd, "promoDmText").replace(/\r\n/g, "\n"),
      quickPrize: str(fd, "quickPrize"),
      quickWinners: int(fd, "quickWinners"),
      quickDaysAhead: int(fd, "quickDaysAhead"),
      quickTime: str(fd, "quickTime"),
      quickBoostersOnly: bool(fd, "quickBoostersOnly"),
    });
    await prisma.giveawaySettings.upsert({ where: { id: 1 }, create: { id: 1, ...data }, update: data });
    // Текст сообщения в журнал не пишем целиком: он длинный и есть на странице настроек.
    await audit(user, MODULE, "giveaway.settings", null, { ...data, promoDmText: `${data.promoDmText.length} символов` });
    revalidatePath("/giveaway", "layout");
    return "Настройки сохранены. Бот применит их в течение 15 секунд, подсказки команды в Discord обновятся в течение минуты.";
  });
}

// Итоги подводит бот: панель только переносит время итогов на «сейчас», и бот подхватит розыгрыш за 10 секунд.
export async function finishGiveawayNow(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  return runAction("any", async (user) => {
    const id = idParam(fd);
    // Неопубликованный розыгрыш ещё никто не видел: подводить итоги не из кого.
    const { count } = await prisma.giveaway.updateMany({ where: { id, status: "ACTIVE", needsPublish: false }, data: { endsAt: new Date() } });
    if (count === 0) throw new ActionError("Этот розыгрыш уже не идёт или ещё не опубликован в канале");
    const g = await prisma.giveaway.findUniqueOrThrow({ where: { id } });
    await audit(user, MODULE, "giveaway.finish", `#${id} ${g.prize}`);
    revalidatePath("/giveaway", "layout");
    return `Итоги розыгрыша #${id} будут подведены в течение 10 секунд, если бот работает.`;
  });
}

export async function cancelGiveaway(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  return runAction("any", async (user) => {
    const id = idParam(fd);
    const { count } = await prisma.giveaway.updateMany({ where: { id, status: "ACTIVE" }, data: { status: "CANCELLED", needsMessageUpdate: true, needsPublish: false } });
    if (count === 0) throw new ActionError("Этот розыгрыш уже не идёт");
    const g = await prisma.giveaway.findUniqueOrThrow({ where: { id } });
    await audit(user, MODULE, "giveaway.cancel", `#${id} ${g.prize}`);
    revalidatePath("/giveaway", "layout");
    return `Розыгрыш #${id} отменён. Бот уберёт кнопку «Участвовать» в течение 10 секунд.`;
  });
}
