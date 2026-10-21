import { z } from "zod";

// Всё остальное (ключи, тексты, расписание) задаётся в панели, здесь только то,
// без чего бот не запустится.
const schema = z.object({
  DATABASE_URL: z.string({ error: "DATABASE_URL не задан" }).startsWith("postgres", "DATABASE_URL должен указывать на PostgreSQL"),
  // Адрес панели: для ссылки «Открыть в панели» в сообщениях Telegram. Необязателен.
  PANEL_URL: z
    .string()
    .trim()
    .default("")
    .transform((v) => v.replace(/\/+$/, "")),
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  // Печатаем только названия переменных, не их значения.
  console.error("Ошибка конфигурации бота объявлений:");
  for (const issue of parsed.error.issues) console.error(`  ${issue.path.join(".")}: ${issue.message}`);
  process.exit(1);
}

export const config = parsed.data;
