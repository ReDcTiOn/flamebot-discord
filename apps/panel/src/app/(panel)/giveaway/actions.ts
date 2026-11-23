"use server";

import { randomBytes } from "node:crypto";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import {
  GIVEAWAY_MAX_DAYS,
  GIVEAWAY_MAX_WINNERS,
  GIVEAWAY_REPEAT_OPTIONS,
  formatInZone,
  getGiveawaySettings,
  giveawaySettingsSchema,
  parseCodes,
  parseTime,
  prisma,
  promoCodesProblem,
  snowflake,
  zonedToDate,
  zonedParts,
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

    const now = Date.now();
    const maxDuration = GIVEAWAY_MAX_DAYS * 86_400_000;
    let startsAt: Date | null = null;
    let endsAt: Date;
    if (str(fd, "publishMode") === "scheduled") {
      const start = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}:\d{2})$/.exec(str(fd, "startsAt"));
      const time = start ? parseTime(start[4]!) : null;
      if (!start || !time) throw new ActionError("Укажи дату и время старта");
      const date = { year: Number(start[1]), month: Number(start[2]), day: Number(start[3]) };
      startsAt = zonedToDate(date, time, s.timezone);
      const actual = zonedParts(startsAt, s.timezone);
      if (actual.year !== date.year || actual.month !== date.month || actual.day !== date.day || actual.hour !== time.hour || actual.minute !== time.minute) {
        throw new ActionError("Указанное время старта не существует в часовом поясе розыгрышей");
      }
      if (startsAt.getTime() <= now || startsAt.getTime() - now > maxDuration) throw new ActionError("Запланируй старт в будущем в пределах года");
      const unit = str(fd, "durationUnit");
      const multiplier = unit === "days" ? 86_400_000 : unit === "hours" ? 3_600_000 : 60_000;
      const duration = int(fd, "duration") * multiplier;
      if (!Number.isSafeInteger(duration) || duration < 5 * 60_000 || duration > maxDuration) {
        throw new ActionError("Длительность должна быть от 5 минут до года");
      }
      endsAt = new Date(startsAt.getTime() + duration);
    } else {
      const date = /^(\d{4})-(\d{2})-(\d{2})$/.exec(str(fd, "date"));
      const time = parseTime(str(fd, "time"));
      if (!date) throw new ActionError("Укажи дату итогов");
      if (!time) throw new ActionError("Укажи время итогов в формате ЧЧ:ММ");
      endsAt = zonedToDate({ year: Number(date[1]), month: Number(date[2]), day: Number(date[3]) }, time, s.timezone);
      if (endsAt.getTime() <= now + 60_000) throw new ActionError(`Время итогов должно быть в будущем. Сейчас ${formatInZone(new Date(now), s.timezone)} (${s.timezoneLabel}).`);
      if (endsAt.getTime() - now > maxDuration) throw new ActionError("Розыгрыш не может длиться дольше года.");
    }

    const repeatRaw = str(fd, "repeatEveryDays");
    const repeatDays = startsAt && repeatRaw ? Number(repeatRaw) : 0;
    if (!GIVEAWAY_REPEAT_OPTIONS.some(option => option.days === repeatDays)) throw new ActionError("Выбери частоту повторения из списка");
    if (repeatDays && startsAt && endsAt.getTime() - startsAt.getTime() > repeatDays * 86_400_000) {
      throw new ActionError("Длительность розыгрыша не может быть больше интервала повторения");
    }
    const auto = str(fd, "promoMode") === "auto";
    if (repeatDays && str(fd, "promoMode") === "manual") {
      throw new ActionError("Для повторяющегося розыгрыша выбери автоматические промокоды или розыгрыш без промокодов");
    }
    const amount = auto ? int(fd, "autoPromoAmount") : null;
    if (amount !== null && (!Number.isSafeInteger(amount) || amount < 1 || amount > 100_000)) {
      throw new ActionError("Укажи целую сумму от 1 до 100 000 ₽ на победителя");
    }
    if (auto && !await prisma.giveawaySecret.count({ where: { name: "flamerustApiKey" } })) {
      throw new ActionError("Сначала сохрани API-ключ flamerust.gg в «Розыгрыши → Подключение»");
    }
    const codes = auto ? [] : parseCodes(str(fd, "codes"));
    if (repeatDays && codes.length) throw new ActionError("Готовые промокоды можно использовать только в разовом розыгрыше");
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
        startsAt,
        repeatEveryDays: repeatDays || null,
        repeatTimezone: repeatDays ? s.timezone : null,
        autoPromoAmount: amount,
        autoPromoSeed: auto ? randomBytes(32).toString("hex") : null,
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
      startsAt: startsAt?.toISOString() ?? null,
      repeatEveryDays: repeatDays || null,
      autoPromoAmount: amount,
      boostersOnly: d.boostersOnly,
      promoCodes: codes.length,
    });
    revalidatePath("/giveaway", "layout");
    if (startsAt) return `Розыгрыш #${g.id} запланирован на ${formatInZone(startsAt, s.timezone)} в #${channel.name}.`;
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
      defaultRepeatEveryDays: Number(str(fd, "defaultRepeatEveryDays") || "0"),
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
    const { count } = await prisma.giveaway.updateMany({ where: { id, status: "ACTIVE" }, data: { status: "CANCELLED", needsMessageUpdate: true, needsPublish: false, publishError: null, publishRetryAt: null } });
    if (count === 0) throw new ActionError("Этот розыгрыш уже не идёт");
    const g = await prisma.giveaway.findUniqueOrThrow({ where: { id } });
    await audit(user, MODULE, "giveaway.cancel", `#${id} ${g.prize}`);
    revalidatePath("/giveaway", "layout");
    return `Розыгрыш #${id} отменён. Бот уберёт кнопку «Участвовать» в течение 10 секунд.`;
  });
}
