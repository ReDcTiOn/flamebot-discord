import { mkdir, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fmtWipe, mapsRuleProblems, upcomingWipes } from "@flamebot/core";
import { checkWebhook } from "./clients/discord.js";
import { errorText } from "./events.js";
import { tmpDir } from "./service.js";
import { ctx } from "./state.js";

// Проверка подключений перед первым запуском (как прежний check.py). Ничего не генерирует
// и не пишет в Discord: только читает лимиты, конфиги, задачи вайпа и пробует запись в S3.

export interface CheckRow {
  name: string;
  ok: boolean | null; // null — не настроено
  text: string;
}

export async function runCheck(): Promise<CheckRow[]> {
  const c = ctx();
  const rows: CheckRow[] = [];
  const add = (name: string, ok: boolean | null, text: string) => rows.push({ name, ok, text });

  // Расписание и правила.
  const problems = c.rules.flatMap((r) => mapsRuleProblems(r, [...c.servers.values()]).map((p) => `${r.key}: ${p}`));
  const next = upcomingWipes(c.rules, c.settings.timezone)[0];
  if (problems.length) add("Расписание", false, problems.join("; "));
  else if (!next) add("Расписание", false, "в ближайшие 8 дней вайпов нет: проверь правила");
  else add("Расписание", true, `правила согласованы, ближайший вайп ${fmtWipe(next.wipeAt, c.settings.timezone, c.settings.timezoneLabel)}`);

  // RustMaps: ключ, лимиты, сохранённые конфиги.
  if (!c.rustmaps) add("RustMaps", null, "API-ключ не задан");
  else {
    try {
      const lim = await c.rustmaps.getLimits();
      const configs = await c.rustmaps.listSavedConfigs();
      const need = [...new Set([...c.servers.values()].map((s) => s.savedConfig))].sort();
      const absent = need.filter((n) => !configs.includes(n));
      add(
        "RustMaps",
        absent.length === 0,
        `лимиты: одновременно ${lim.concurrentCurrent}/${lim.concurrentAllowed}, за месяц ${lim.monthlyUsed}/${lim.monthlyAllowed}` +
          (absent.length ? `; нет сохранённых конфигов: ${absent.join(", ")} (есть: ${configs.join(", ") || "ни одного"})` : `; конфиги на месте: ${need.join(", ")}`),
      );
    } catch (err) {
      add("RustMaps", false, errorText(err));
    }
  }

  // S3: запись, проверка и удаление тестового объекта, доступность по CDN.
  if (!c.storage) add("S3", null, "не заданы ключи, адрес, бакет или адрес CDN");
  else {
    const key = c.storage.keyFor("_check", `check-${Date.now()}.txt`);
    const path = join(tmpDir(), "s3-check.txt");
    try {
      await mkdir(tmpDir(), { recursive: true });
      await writeFile(path, "flamebot maps check\n");
      await c.storage.upload(path, key);
      const problem = await c.storage.checkPublic(c.storage.cdnUrl(key), 20);
      await c.storage.remove(key);
      add("S3", problem === null, problem ? `запись работает, но по ссылке CDN: ${problem}` : "запись, публичная ссылка и удаление работают");
    } catch (err) {
      add("S3", false, `${errorText(err)}. Если адресация не та, переключи path/virtual в настройках`);
    } finally {
      await unlink(path).catch(() => undefined);
    }
  }

  // Вебхук Discord: GET без отправки сообщения.
  if (!c.webhook) add("Discord", null, "вебхук не задан");
  else {
    try {
      const hook = await checkWebhook(c.webhook);
      add("Discord", true, `вебхук «${hook.name}» в канале ${hook.channelId}`);
    } catch (err) {
      add("Discord", false, errorText(err));
    }
  }

  // Telegram.
  if (!c.telegram) add("Telegram", null, "токен не задан: бот работает только через панель");
  else {
    try {
      const me = await c.telegram.getMe();
      add("Telegram", c.adminIds.size > 0, `бот @${me.username ?? me.id}` + (c.adminIds.size ? `, админов: ${c.adminIds.size}` : ", но не указаны Telegram ID админов — кнопки никто не сможет нажать"));
    } catch (err) {
      add("Telegram", false, errorText(err));
    }
  }

  // Pterodactyl: ключ и доступ к серверам из настроек.
  if (!c.ptero) add("Pterodactyl", null, "адрес панели или ключ ptlc_ не заданы: ссылки в задачи вайпа не пишутся");
  else {
    try {
      const { status, servers } = await c.ptero.whoami();
      if (status !== 200) add("Pterodactyl", false, `панель ответила ${status} на ключ`);
      else {
        const visible = new Set(servers.map((s) => s.id));
        const lost = [...c.servers.values()].filter((s) => s.pteroUuid && !visible.has(s.pteroUuid)).map((s) => s.title);
        add("Pterodactyl", lost.length === 0, lost.length ? `ключу не видны серверы: ${lost.join(", ")}` : `ключу доступно серверов: ${servers.length}`);
      }
    } catch (err) {
      add("Pterodactyl", false, errorText(err));
    }
  }
  return rows;
}
