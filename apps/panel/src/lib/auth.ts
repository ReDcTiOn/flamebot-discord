import { redirect } from "next/navigation";
import { z } from "zod";
import { prisma, Prisma } from "@flamebot/core";
import { rateLimit } from "./rateLimit";
import { getUser, type PanelUser } from "./session";

// Для страниц: без сессии — на вход, без нужного уровня — на главную.
export async function requirePage(level: "any" | "full" = "any"): Promise<PanelUser> {
  const user = await getUser();
  if (!user) redirect("/login");
  if (level === "full" && user.level !== "full") redirect("/");
  return user;
}

export type ActionResult = { ok: boolean; message: string; at: number } | null;

export class ActionError extends Error {}

// Обёртка для каждого server action: проверка сессии и уровня, ограничение частоты,
// понятные ошибки валидации, запись в журнал делает сама функция.
export async function runAction(
  level: "any" | "full",
  fn: (user: PanelUser) => Promise<string>,
): Promise<ActionResult> {
  const user = await getUser();
  if (!user) return { ok: false, message: "Сессия истекла. Войди заново.", at: Date.now() };
  if (level === "full" && user.level !== "full") {
    return { ok: false, message: "Это может делать только администратор сервера.", at: Date.now() };
  }
  if (!rateLimit(`action:${user.id}`, 60, 60_000)) {
    return { ok: false, message: "Слишком много действий. Подожди минуту.", at: Date.now() };
  }

  try {
    const message = await fn(user);
    return { ok: true, message, at: Date.now() };
  } catch (err) {
    if (err instanceof ActionError) return { ok: false, message: err.message, at: Date.now() };
    if (err instanceof z.ZodError) {
      return { ok: false, message: err.issues[0]?.message ?? "Проверь введённые данные", at: Date.now() };
    }
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      return { ok: false, message: "Такое значение уже есть.", at: Date.now() };
    }
    console.error("Ошибка действия панели", err);
    return { ok: false, message: "Не получилось сохранить. Попробуй ещё раз.", at: Date.now() };
  }
}

export async function audit(
  user: PanelUser,
  module: string,
  action: string,
  target: string | null,
  details?: Prisma.InputJsonValue,
): Promise<void> {
  await prisma.auditLog.create({
    data: { module, actorId: user.id, actorName: user.username, action, target, details },
  });
}
