import { z } from "zod";

const schema = z.object({
  DISCORD_CLIENT_ID: z.string({ error: "DISCORD_CLIENT_ID не задан" }).regex(/^\d{17,20}$/, "DISCORD_CLIENT_ID должен быть Discord ID"),
  DISCORD_CLIENT_SECRET: z.string({ error: "DISCORD_CLIENT_SECRET не задан" }).min(16, "DISCORD_CLIENT_SECRET не задан"),
  GUILD_ID: z.string({ error: "GUILD_ID не задан" }).regex(/^\d{17,20}$/, "GUILD_ID должен быть Discord ID"),
  PANEL_URL: z.url("PANEL_URL должен быть полным адресом панели, например https://panel.example.com"),
  SESSION_SECRET: z.string({ error: "SESSION_SECRET не задан" }).min(32, "SESSION_SECRET должен быть не короче 32 символов"),
  DATABASE_URL: z.string({ error: "DATABASE_URL не задан" }).startsWith("postgres"),
  // Учитывать X-Forwarded-For только за своим reverse proxy, иначе IP можно подделать.
  TRUST_PROXY: z
    .enum(["true", "false"])
    .default("false")
    .transform((v) => v === "true"),
});

export type Env = z.infer<typeof schema>;

let cached: Env | null = null;

// Проверяем лениво: во время `next build` переменных может не быть.
export function env(): Env {
  if (cached) return cached;
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    const fields = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    throw new Error(`Ошибка конфигурации панели: ${fields}`);
  }
  cached = parsed.data;
  return cached;
}

export function isSecureOrigin(): boolean {
  return env().PANEL_URL.startsWith("https://");
}

export function sessionCookieName(): string {
  // Префикс __Host- запрещает браузеру принимать cookie с чужого поддомена или без HTTPS.
  return isSecureOrigin() ? "__Host-flamebot_session" : "flamebot_session";
}

export function oauthCookieName(): string {
  return isSecureOrigin() ? "__Host-flamebot_oauth" : "flamebot_oauth";
}
