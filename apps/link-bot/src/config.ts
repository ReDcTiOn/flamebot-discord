import { z } from "zod";

const SNOWFLAKE = /^\d{17,20}$/;

const schema = z.object({
  GUILD_ID: z.string({ error: "GUILD_ID не задан" }).regex(SNOWFLAKE, "GUILD_ID должен быть Discord ID"),
  DATABASE_URL: z.string({ error: "DATABASE_URL не задан" }).startsWith("postgres", "DATABASE_URL должен указывать на PostgreSQL"),
  // HTTP API для плагина на игровых серверах. Наружу — только через Caddy по HTTPS (docs/DEPLOY.md).
  LINK_API_PORT: z.coerce.number().int().min(1).max(65535).default(3010),
  // В Docker слушаем все адреса контейнера (наружу порт открыт только на 127.0.0.1 хоста),
  // при запуске без Docker — только localhost.
  LINK_API_HOST: z.string().trim().min(1).default("127.0.0.1"),
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  // Печатаем только названия переменных, не их значения.
  console.error("Ошибка конфигурации бота привязки:");
  for (const issue of parsed.error.issues) console.error(`  ${issue.path.join(".")}: ${issue.message}`);
  process.exit(1);
}

export const config = parsed.data;
