import { NextResponse, type NextRequest } from "next/server";
import { randomToken } from "@/lib/crypto";
import { authorizeUrl } from "@/lib/discord";
import { env, isSecureOrigin, oauthCookieName } from "@/lib/env";
import { rateLimit } from "@/lib/rateLimit";
import { clientIp } from "@/lib/request";

export async function GET(request: NextRequest) {
  if (!rateLimit(`login:${clientIp(request.headers)}`, 10, 60_000)) {
    return NextResponse.redirect(new URL("/login?error=rate", env().PANEL_URL));
  }

  // state привязывает ответ Discord к этому браузеру и защищает вход от CSRF.
  const state = randomToken(24);
  const response = NextResponse.redirect(authorizeUrl(state));
  response.cookies.set(oauthCookieName(), state, {
    httpOnly: true,
    secure: isSecureOrigin(),
    sameSite: "lax",
    path: "/",
    maxAge: 600,
  });
  return response;
}
