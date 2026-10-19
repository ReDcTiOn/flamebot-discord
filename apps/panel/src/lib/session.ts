import { cookies, headers } from "next/headers";
import { cache } from "react";
import { prisma, type AdminSession } from "@flamebot/core";
import { computeAccess, type AccessLevel } from "./access";
import { decrypt, encrypt, randomToken, sha256 } from "./crypto";
import { DiscordAuthError, fetchGuildMember } from "./discord";
import { isSecureOrigin, sessionCookieName } from "./env";
import { clientIp } from "./request";

// Сессия живёт 12 часов, права перепроверяются в Discord каждые 5 минут.
// Сняли роль или выгнали с сервера — доступ пропадёт максимум через 5 минут.
const SESSION_TTL_MS = 12 * 3_600_000;
const REVERIFY_MS = 5 * 60_000;

export interface PanelUser {
  id: string;
  username: string;
  avatarHash: string | null;
  level: Exclude<AccessLevel, null>;
  sessionId: string;
}

export async function createSession(input: {
  userId: string;
  username: string;
  avatarHash: string | null;
  level: Exclude<AccessLevel, null>;
  accessToken: string;
}): Promise<void> {
  const token = randomToken(32);
  const h = await headers();
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);

  await prisma.adminSession.deleteMany({ where: { expiresAt: { lt: new Date() } } });

  // У одного человека не больше 5 активных сессий: старые удаляем.
  const existing = await prisma.adminSession.findMany({
    where: { userId: input.userId },
    orderBy: { createdAt: "desc" },
    skip: 4,
    select: { id: true },
  });
  if (existing.length) await prisma.adminSession.deleteMany({ where: { id: { in: existing.map((s) => s.id) } } });

  await prisma.adminSession.create({
    data: {
      id: sha256(token),
      userId: input.userId,
      username: input.username,
      avatarHash: input.avatarHash,
      isGuildAdmin: input.level === "full",
      accessTokenEnc: encrypt(input.accessToken),
      ip: clientIp(h),
      userAgent: h.get("user-agent")?.slice(0, 300) ?? null,
      expiresAt,
      lastVerifiedAt: new Date(),
    },
  });

  (await cookies()).set(sessionCookieName(), token, {
    httpOnly: true,
    secure: isSecureOrigin(),
    sameSite: "lax",
    path: "/",
    expires: expiresAt,
  });
}

async function reverify(session: AdminSession): Promise<Exclude<AccessLevel, null> | null> {
  const accessToken = decrypt(session.accessTokenEnc);
  if (!accessToken) return null;
  try {
    const member = await fetchGuildMember(accessToken);
    if (!member) return null;
    return await computeAccess(session.userId, member.roles);
  } catch (err) {
    // Токен отозван — выкидываем. Discord временно недоступен — оставляем прежний уровень.
    if (err instanceof DiscordAuthError) return null;
    return session.isGuildAdmin ? "full" : "manager";
  }
}

// cache() — одна проверка на запрос, даже если getUser вызвали в нескольких местах.
export const getUser = cache(async (): Promise<PanelUser | null> => {
  const token = (await cookies()).get(sessionCookieName())?.value;
  if (!token || token.length > 100) return null;

  const id = sha256(token);
  const session = await prisma.adminSession.findUnique({ where: { id } });
  if (!session) return null;
  if (session.expiresAt.getTime() <= Date.now()) {
    await prisma.adminSession.delete({ where: { id } }).catch(() => undefined);
    return null;
  }

  let level: Exclude<AccessLevel, null> = session.isGuildAdmin ? "full" : "manager";
  if (Date.now() - session.lastVerifiedAt.getTime() > REVERIFY_MS) {
    const fresh = await reverify(session);
    if (!fresh) {
      await prisma.adminSession.delete({ where: { id } }).catch(() => undefined);
      return null;
    }
    level = fresh;
    await prisma.adminSession.update({
      where: { id },
      data: { lastVerifiedAt: new Date(), isGuildAdmin: fresh === "full" },
    });
  }

  return { id: session.userId, username: session.username, avatarHash: session.avatarHash, level, sessionId: id };
});

export async function destroySession(): Promise<string | null> {
  const store = await cookies();
  const token = store.get(sessionCookieName())?.value;
  store.delete(sessionCookieName());
  if (!token) return null;
  const session = await prisma.adminSession.findUnique({ where: { id: sha256(token) } });
  if (!session) return null;
  await prisma.adminSession.delete({ where: { id: session.id } }).catch(() => undefined);
  return decrypt(session.accessTokenEnc);
}
