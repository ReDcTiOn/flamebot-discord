import { env } from "./env";

const API = "https://discord.com/api/v10";
export const OAUTH_SCOPES = ["identify", "guilds.members.read"] as const;

export interface DiscordUser {
  id: string;
  username: string;
  global_name: string | null;
  avatar: string | null;
}

export interface DiscordGuildMember {
  roles: string[];
  nick: string | null;
}

export class DiscordAuthError extends Error {}

export function redirectUri(): string {
  return new URL("/api/auth/callback", env().PANEL_URL).toString();
}

export function authorizeUrl(state: string): string {
  const url = new URL("https://discord.com/oauth2/authorize");
  url.searchParams.set("client_id", env().DISCORD_CLIENT_ID);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("redirect_uri", redirectUri());
  url.searchParams.set("scope", OAUTH_SCOPES.join(" "));
  url.searchParams.set("state", state);
  url.searchParams.set("prompt", "none");
  return url.toString();
}

async function discordFetch(path: string, init: RequestInit): Promise<Response> {
  return fetch(`${API}${path}`, { ...init, cache: "no-store", signal: AbortSignal.timeout(10_000) });
}

export async function exchangeCode(code: string): Promise<{ accessToken: string; expiresIn: number }> {
  const res = await discordFetch("/oauth2/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: env().DISCORD_CLIENT_ID,
      client_secret: env().DISCORD_CLIENT_SECRET,
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri(),
    }),
  });
  if (!res.ok) throw new DiscordAuthError(`Discord отклонил код авторизации (${res.status})`);
  const json = (await res.json()) as { access_token?: string; expires_in?: number; scope?: string };
  if (!json.access_token) throw new DiscordAuthError("Discord не вернул токен");
  const granted = new Set((json.scope ?? "").split(" "));
  if (!OAUTH_SCOPES.every((s) => granted.has(s))) throw new DiscordAuthError("Не выданы нужные разрешения");
  return { accessToken: json.access_token, expiresIn: json.expires_in ?? 604800 };
}

export async function fetchMe(accessToken: string): Promise<DiscordUser> {
  const res = await discordFetch("/users/@me", { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!res.ok) throw new DiscordAuthError(`Не удалось получить профиль (${res.status})`);
  return (await res.json()) as DiscordUser;
}

// null — пользователя нет на сервере. Ошибка — токен недействителен или Discord недоступен.
export async function fetchGuildMember(accessToken: string): Promise<DiscordGuildMember | null> {
  const res = await discordFetch(`/users/@me/guilds/${env().GUILD_ID}/member`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (res.status === 404) return null;
  if (res.status === 401) throw new DiscordAuthError("Токен Discord недействителен");
  if (!res.ok) throw new Error(`Discord недоступен (${res.status})`);
  return (await res.json()) as DiscordGuildMember;
}

export async function revokeToken(accessToken: string): Promise<void> {
  await discordFetch("/oauth2/token/revoke", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: env().DISCORD_CLIENT_ID,
      client_secret: env().DISCORD_CLIENT_SECRET,
      token: accessToken,
      token_type_hint: "access_token",
    }),
  }).catch(() => undefined);
}

export function avatarUrl(userId: string, hash: string | null, size = 64): string {
  if (!hash) return `https://cdn.discordapp.com/embed/avatars/${Number(BigInt(userId) >> 22n) % 6}.png`;
  return `https://cdn.discordapp.com/avatars/${userId}/${hash}.png?size=${size}`;
}
