import { z } from "zod";

const schema = z.object({
  DATABASE_URL: z.string({ error: "DATABASE_URL не задан" }).startsWith("postgres", "DATABASE_URL должен указывать на PostgreSQL"),
  // Приватный ключ X25519 для расшифровки секретов. Сгенерировать: pnpm -F online-bot gen-key
  ONLINE_SECRET_KEY: z.string({ error: "ONLINE_SECRET_KEY не задан. Сгенерируй: pnpm -F online-bot gen-key" }).min(40),
  // Разрешить RCON на внутренние адреса (локальная сеть, localhost). По умолчанию запрещено.
  ALLOW_PRIVATE_RCON: z
    .enum(["true", "false"])
    .default("false")
    .transform((v) => v === "true"),
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  console.error("Ошибка конфигурации бота онлайна:");
  for (const issue of parsed.error.issues) console.error(`  ${issue.path.join(".")}: ${issue.message}`);
  process.exit(1);
}

export const config = parsed.data;
