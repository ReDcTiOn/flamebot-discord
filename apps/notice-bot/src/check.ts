import { noticeRuleProblems } from "@flamebot/core";
import { checkWebhook } from "./clients/discord.js";
import { listPromos } from "./clients/gamestores.js";
import { checkVk } from "./clients/vk.js";
import { errorText } from "./events.js";
import { ctx } from "./state.js";

// Проверка подключений из панели: ничего не публикует и не создаёт.

export interface CheckRow {
  name: string;
  ok: boolean | null; // null — не настроено, но и не обязательно
  text: string;
}

async function probe(name: string, fn: () => Promise<string>): Promise<CheckRow> {
  try {
    return { name, ok: true, text: await fn() };
  } catch (err) {
    return { name, ok: false, text: errorText(err).slice(0, 300) };
  }
}

export async function runCheck(): Promise<CheckRow[]> {
  const c = ctx();
  const rows: CheckRow[] = [];

  rows.push(
    c.telegram
      ? await probe("Telegram", async () => {
          const me = await c.telegram!.getMe();
          return `бот @${me.username ?? me.id}, админов: ${c.adminIds.length}${c.adminIds.length ? "" : " — укажи их в настройках"}`;
        })
      : { name: "Telegram", ok: false, text: "токен не задан" },
  );
  if (rows[0]!.ok && !c.adminIds.length) rows[0]!.ok = false;

  rows.push(c.live.discord ? await probe("Discord", async () => `вебхук «${await checkWebhook(c.live.discord!)}»`) : { name: "Discord", ok: false, text: "вебхук не задан" });
  rows.push(
    c.live.vkToken && c.live.vkGroupId
      ? await probe("ВКонтакте", async () => {
          const name = await checkVk(c.live.vkToken!, c.live.vkGroupId!);
          const photos = (["regular", "global"] as const).filter((k) => !c.live.vkPhotos[k]);
          return `сообщество «${name}»${photos.length ? `; нет ID фото: ${photos.map((k) => (k === "regular" ? "обычный" : "глобальный")).join(", ")}` : ""}`;
        })
      : { name: "ВКонтакте", ok: false, text: "ключ или ID сообщества не заданы" },
  );
  rows.push(c.gamestores ? await probe("gamestores", async () => `ключи работают, активных промокодов: ${(await listPromos(c.gamestores!)).length}`) : { name: "gamestores", ok: false, text: "ID магазина или секретный ключ не заданы" });

  if (c.test.discord) rows.push(await probe("Discord (тест)", async () => `вебхук «${await checkWebhook(c.test.discord!)}»`));
  if (c.test.vkToken && c.test.vkGroupId) rows.push(await probe("ВКонтакте (тест)", async () => `сообщество «${await checkVk(c.test.vkToken!, c.test.vkGroupId!)}»`));

  const noImages = (["regular", "global"] as const).filter((k) => !c.images[k]);
  rows.push({ name: "Картинки", ok: noImages.length === 0, text: noImages.length ? `не загружены: ${noImages.map((k) => (k === "regular" ? "обычный" : "глобальный")).join(", ")}` : "обе загружены" });

  const templates = [...c.templates.values()];
  const problems = c.rules.filter((r) => r.enabled).flatMap((r) => noticeRuleProblems(r, templates).map((p) => `${r.key}: ${p}`));
  rows.push({ name: "Расписание", ok: problems.length === 0 && c.rules.some((r) => r.enabled), text: problems.length ? problems.join("; ") : c.rules.some((r) => r.enabled) ? `правил: ${c.rules.filter((r) => r.enabled).length}, тексты выбраны` : "нет ни одного правила" });
  if (c.settings.dryRun) rows.push({ name: "Режим", ok: null, text: "пробный: наружу ничего не уходит" });
  return rows;
}
