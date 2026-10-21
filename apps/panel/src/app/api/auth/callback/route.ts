import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@flamebot/core";
import { computeAccess } from "@/lib/access";
import { safeEqual } from "@/lib/crypto";
import { DiscordAuthError, exchangeCode, fetchGuildAccess, fetchGuildMember, fetchMe, revokeToken } from "@/lib/discord";
import { env, oauthCookieName } from "@/lib/env";
import { rateLimit } from "@/lib/rateLimit";
import { clientIp } from "@/lib/request";
import { createSession } from "@/lib/session";

function fail(code: string) {
  const response = NextResponse.redirect(new URL(`/login?error=${code}`, env().PANEL_URL));
  response.cookies.delete(oauthCookieName());
  return response;
}

export async function GET(request: NextRequest) {
  if (!rateLimit(`callback:${clientIp(request.headers)}`, 10, 60_000)) return fail("rate");

  const params = request.nextUrl.searchParams;
  const code = params.get("code");
  const state = params.get("state");
  const expected = request.cookies.get(oauthCookieName())?.value;

  if (params.get("error")) return fail("cancelled");
  if (!code || !state || !expected || code.length > 200 || !safeEqual(state, expected)) return fail("state");

  let accessToken: string | null = null;
  try {
    ({ accessToken } = await exchangeCode(code));
    const user = await fetchMe(accessToken);
    const member = await fetchGuildMember(accessToken);
    if (!member) {
      await revokeToken(accessToken);
      return fail("not_member");
    }

    const level = await computeAccess(user.id, member.roles, await fetchGuildAccess(accessToken));
    if (!level) {
      await revokeToken(accessToken);
      await prisma.auditLog.create({
        data: { module: "panel", actorId: user.id, actorName: user.username, action: "login.denied", target: null },
      });
      return fail("denied");
    }

    await createSession({
      userId: user.id,
      username: user.global_name ?? user.username,
      avatarHash: user.avatar,
      level,
      accessToken,
    });
    await prisma.auditLog.create({
      data: {
        module: "panel",
        actorId: user.id,
        actorName: user.global_name ?? user.username,
        action: "login",
        target: null,
        details: { level, ip: clientIp(request.headers) },
      },
    });

    const response = NextResponse.redirect(new URL("/", env().PANEL_URL));
    response.cookies.delete(oauthCookieName());
    return response;
  } catch (err) {
    if (accessToken) await revokeToken(accessToken);
    if (!(err instanceof DiscordAuthError)) console.error("Ошибка входа через Discord", err);
    return fail("discord");
  }
}
