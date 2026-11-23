"use server";

import { revalidatePath } from "next/cache";
import { GIVEAWAY_FLAMERUST_KEY_CONTEXT, prisma, sealSecret } from "@flamebot/core";
import { ActionError, audit, runAction, type ActionResult } from "@/lib/auth";
import { str } from "@/lib/form";

const botKey = "giveaway";
const name = "flamerustApiKey";
const path = "/giveaway/connection";

export async function saveGiveawayFlameRustKey(_prev: ActionResult, form: FormData): Promise<ActionResult> {
  return runAction("full", async (user) => {
    const value = str(form, name).trim();
    if (!/^[!-~]{8,200}$/.test(value)) throw new ActionError("Вставь API-ключ flamerust.gg без пробелов.");
    const key = await prisma.botPublicKey.findUnique({ where: { botKey } });
    if (!key) throw new ActionError("Запусти сервис бота розыгрышей, чтобы он передал панели открытый ключ.");
    const data = {
      valueEnc: sealSecret(key.publicKey, value, GIVEAWAY_FLAMERUST_KEY_CONTEXT),
      setAt: new Date(),
      setByName: user.username,
    };
    await prisma.giveawaySecret.upsert({ where: { name }, create: { name, ...data }, update: data });
    await audit(user, botKey, "giveaway.secret.save", "Сохранён API-ключ flamerust.gg");
    revalidatePath(path);
    return "API-ключ flamerust.gg сохранён.";
  });
}

export async function clearGiveawayFlameRustKey(): Promise<ActionResult> {
  return runAction("full", async (user) => {
    await prisma.giveawaySecret.deleteMany({ where: { name } });
    await audit(user, botKey, "giveaway.secret.clear", "Удалён API-ключ flamerust.gg");
    revalidatePath(path);
    return "API-ключ flamerust.gg удалён.";
  });
}
