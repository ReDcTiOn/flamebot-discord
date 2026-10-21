"use server";

import { revalidatePath } from "next/cache";
import { giveawaySettingsSchema, prisma } from "@flamebot/core";
import { ActionError, audit, runAction, type ActionResult } from "@/lib/auth";
import { bool, idParam, int, str } from "@/lib/form";

const MODULE = "giveaway";

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
    const { count } = await prisma.giveaway.updateMany({ where: { id, status: "ACTIVE" }, data: { endsAt: new Date() } });
    if (count === 0) throw new ActionError("Этот розыгрыш уже не идёт");
    const g = await prisma.giveaway.findUniqueOrThrow({ where: { id } });
    await audit(user, MODULE, "giveaway.finish", `#${id} ${g.prize}`);
    revalidatePath("/giveaway", "layout");
    return `Итоги розыгрыша #${id} будут подведены в течение 10 секунд, если бот работает.`;
  });
}

export async function cancelGiveaway(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  return runAction("any", async (user) => {
    const id = idParam(fd);
    const { count } = await prisma.giveaway.updateMany({ where: { id, status: "ACTIVE" }, data: { status: "CANCELLED", needsMessageUpdate: true } });
    if (count === 0) throw new ActionError("Этот розыгрыш уже не идёт");
    const g = await prisma.giveaway.findUniqueOrThrow({ where: { id } });
    await audit(user, MODULE, "giveaway.cancel", `#${id} ${g.prize}`);
    revalidatePath("/giveaway", "layout");
    return `Розыгрыш #${id} отменён. Бот уберёт кнопку «Участвовать» в течение 10 секунд.`;
  });
}
