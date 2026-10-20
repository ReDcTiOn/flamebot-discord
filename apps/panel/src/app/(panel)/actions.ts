"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { accessSettingsSchema, prisma } from "@flamebot/core";
import { ActionError, audit, runAction, type ActionResult } from "@/lib/auth";
import { revokeToken } from "@/lib/discord";
import { ids, str } from "@/lib/form";
import { modules } from "@/modules";
import { destroySession, getUser } from "@/lib/session";

export async function logout(): Promise<void> {
  const user = await getUser();
  const token = await destroySession();
  if (token) await revokeToken(token);
  if (user) await audit(user, "panel", "logout", null);
  redirect("/login");
}

export async function saveAccess(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  return runAction("full", async (user) => {
    const data = accessSettingsSchema.parse({ panelRoleIds: ids(fd, "panelRoleIds") });
    const existing = await prisma.guildRole.count({ where: { id: { in: data.panelRoleIds } } });
    if (existing !== data.panelRoleIds.length) throw new ActionError("Одна из ролей не найдена");
    await prisma.panelSettings.upsert({ where: { id: 1 }, create: { id: 1, ...data }, update: data });
    await audit(user, "panel", "access.update", null, data);
    revalidatePath("/access");
    return "Доступ обновлён. Новые права применятся при следующей проверке сессии (до 5 минут).";
  });
}

export async function revokeAllSessions(_prev: ActionResult, _fd: FormData): Promise<ActionResult> {
  return runAction("full", async (user) => {
    const { count } = await prisma.adminSession.deleteMany({ where: { id: { not: user.sessionId } } });
    await audit(user, "panel", "sessions.revoke_all", null, { count });
    revalidatePath("/access");
    return `Завершено сессий: ${count}. Твоя текущая сессия осталась.`;
  });
}

// Запуск и остановка бота. Бот сам проверяет флаг каждые 5 секунд.
export async function setBotEnabled(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  return runAction("full", async (user) => {
    const botKey = str(fd, "botKey");
    const mod = modules.find((m) => m.key === botKey);
    if (!mod) throw new ActionError("Неизвестный бот");
    const enabled = str(fd, "enabled") === "on";
    await prisma.botControl.upsert({
      where: { botKey },
      create: { botKey, enabled, changedById: user.id, changedByName: user.username },
      update: { enabled, changedById: user.id, changedByName: user.username },
    });
    await audit(user, botKey, enabled ? "bot.start" : "bot.stop", mod.title);
    revalidatePath("/", "layout");
    return enabled ? `«${mod.title}» запускается, это займёт несколько секунд.` : `«${mod.title}» останавливается и отключится от Discord в течение 5 секунд.`;
  });
}
