import { z } from "zod";

const SNOWFLAKE = /^\d{17,20}$/;

const schema = z.object({
  // Токен отдельного приложения Discord для розыгрышей. Пустой — бот ждёт, пока его зададут
  // в .env, и не мешает обновлению остальных сервисов.
  GIVEAWAY_DISCORD_TOKEN: z.string().trim().default(""),
  GUILD_ID: z.string({ error: "GUILD_ID не задан" }).regex(SNOWFLAKE, "GUILD_ID должен быть Discord ID"),
  DATABASE_URL: z.string({ error: "DATABASE_URL не задан" }).startsWith("postgres", "DATABASE_URL должен указывать на PostgreSQL"),
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  // Печатаем только названия переменных, не их значения.
  console.error("Ошибка конфигурации бота розыгрышей:");
  for (const issue of parsed.error.issues) console.error(`  ${issue.path.join(".")}: ${issue.message}`);
  process.exit(1);
}

export const config = parsed.data;
