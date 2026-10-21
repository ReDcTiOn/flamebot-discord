import { z } from "zod";

const schema = z.object({
  DATABASE_URL: z.string({ error: "DATABASE_URL не задан" }).startsWith("postgres", "DATABASE_URL должен указывать на PostgreSQL"),
  // Приватный ключ X25519 для расшифровки секретов. Необязателен: без него бот берёт ключ из своего
  // тома (BOT_DATA_DIR), а при первом запуске создаёт новый. Старый ключ из .env бот копирует в том.
  ONLINE_SECRET_KEY: z.string().trim().default(""),
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
