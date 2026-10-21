"use server";

import { revalidatePath } from "next/cache";
import {
  NOTICE_BOT_KEY,
  NOTICE_SECRETS,
  noticeAgendaDaySchema,
  noticeReminderSchema,
  noticeRuleProblems,
  noticeRuleSchema,
  noticeSecretContext,
  noticeSecretHint,
  noticeSecretProblem,
  noticeSettingsSchema,
  noticeTemplateSchema,
  parseTimes,
  prisma,
  sealSecret,
  type NoticeSecretName,
  type Prisma,
} from "@flamebot/core";
import { ActionError, audit, runAction, type ActionResult } from "@/lib/auth";
import { bool, int, intOrNull, str } from "@/lib/form";
import { sanitizePostImage } from "@/lib/images";
import { NOTICE_ACTION_KINDS, NOTICE_ACTION_LABEL, runNoticeAction, type NoticeActionKind } from "@/lib/notices";
import { rateLimit } from "@/lib/rateLimit";
import { telegramBotTakenBy } from "@/lib/telegramBots";

const MODULE = NOTICE_BOT_KEY;
const optional = (fd: FormData, name: string) => str(fd, name).trim() || null;
const refresh = () => revalidatePath("/notices", "layout");

// Задание боту: кнопки на странице вайпа, тестовый прогон, проверка подключений.
export async function noticeAction(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  return runAction("any", async (user) => {
    const kind = str(fd, "kind") as NoticeActionKind;
    if (!(NOTICE_ACTION_KINDS as readonly string[]).includes(kind)) throw new ActionError("Неизвестное действие");
    const args: Record<string, string | number> = {};
    // Поле kind занято самим действием, поэтому тип вайпа для теста приходит как wipeKind.
    for (const name of ["key", "templateId", "wipeKind", "id"]) if (str(fd, name)) args[name === "wipeKind" ? "kind" : name] = str(fd, name).slice(0, 64);
    if (str(fd, "minutes")) args.minutes = int(fd, "minutes");
    // Публикация и проверка подключений идут по сети дольше остальных.
    const timeout = kind === "check" || kind === "event.retry" || kind === "promos.list" ? 60_000 : 20_000;
    const result = await runNoticeAction(kind, args, user, timeout);
    // Сами действия бот пишет в историю; в журнал панели — кто и что попросил.
    await audit(user, MODULE, `notices.${kind}`, NOTICE_ACTION_LABEL[kind] ?? kind, args);
    refresh();
    if (!result.ok) throw new ActionError(result.text);
    return result.text;
  });
}

export async function saveNoticeSettings(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  return runAction("any", async (user) => {
    const data = noticeSettingsSchema.parse({
      timezone: str(fd, "timezone"),
      timezoneLabel: str(fd, "timezoneLabel"),
      notifyMinutes: Math.round(Number(str(fd, "notifyHours").replace(",", ".")) * 60),
      remindMinutes: int(fd, "remindMinutes"),
      maxLateMinutes: int(fd, "maxLateMinutes"),
      dryRun: bool(fd, "dryRun"),
      telegramAdminIds: [...new Set(str(fd, "telegramAdminIds").split(/[\s,;]+/).filter(Boolean))],
      vkGroupId: intOrNull(fd, "vkGroupId") === null ? null : Math.abs(int(fd, "vkGroupId")),
      vkPhotoRegular: optional(fd, "vkPhotoRegular"),
      vkPhotoGlobal: optional(fd, "vkPhotoGlobal"),
      testVkGroupId: intOrNull(fd, "testVkGroupId") === null ? null : Math.abs(int(fd, "testVkGroupId")),
      testVkPhotoRegular: optional(fd, "testVkPhotoRegular"),
      testVkPhotoGlobal: optional(fd, "testVkPhotoGlobal"),
      gamestoresStoreId: optional(fd, "gamestoresStoreId"),
      promoCode: str(fd, "promoCode"),
      promoType: str(fd, "promoType"),
      promoDaysAfter: int(fd, "promoDaysAfter"),
      promoEndTime: str(fd, "promoEndTime"),
      promoLimitUses: int(fd, "promoLimitUses"),
      promoTestReal: bool(fd, "promoTestReal"),
      agendaEnabled: bool(fd, "agendaEnabled"),
      agendaSendAt: str(fd, "agendaSendAt"),
      agendaGraceMinutes: int(fd, "agendaGraceMinutes"),
      agendaGreeting: str(fd, "agendaGreeting"),
    });
    if (!Number.isFinite(data.notifyMinutes)) throw new ActionError("За сколько часов присылать — число, например 10");
    await prisma.noticeSettings.upsert({ where: { id: 1 }, create: { id: 1, ...data }, update: data });
    await audit(user, MODULE, "notices.settings", null, data);
    refresh();
    return "Настройки сохранены. Бот применит их в течение 5 секунд.";
  });
}

// ---------------------------------------------------------------- тексты

export async function saveNoticeTemplate(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  return runAction("any", async (user) => {
    let discord: unknown;
    try {
      discord = JSON.parse(str(fd, "discord"));
    } catch {
      throw new ActionError("Сообщение для Discord — это JSON тела вебхука. Проверь скобки и кавычки.");
    }
    const data = noticeTemplateSchema.parse({
      id: str(fd, "id"),
      title: str(fd, "title"),
      kind: str(fd, "kind"),
      discord,
      vk: str(fd, "vk"),
      promoAmount: intOrNull(fd, "promoAmount"),
      sortOrder: intOrNull(fd, "sortOrder") ?? 0,
    });
    const originalId = optional(fd, "originalId");
    const row = { ...data, discord: data.discord as Prisma.InputJsonValue };
    if (originalId && originalId !== data.id) throw new ActionError("ID текста менять нельзя: на него ссылаются правила и вайпы");
    if (originalId) {
      const before = await prisma.noticeTemplate.findUnique({ where: { id: originalId } });
      if (!before) throw new ActionError("Текст не найден");
      if (before.kind !== data.kind && (await usedBy(data.id)).length) {
        throw new ActionError("Тип вайпа у текста менять нельзя, пока его выбирают правила или ждущие вайпы");
      }
      await prisma.noticeTemplate.update({ where: { id: data.id }, data: row });
    } else {
      if (await prisma.noticeTemplate.findUnique({ where: { id: data.id } })) throw new ActionError(`Текст с ID «${data.id}» уже есть`);
      await prisma.noticeTemplate.create({ data: row });
    }
    await audit(user, MODULE, "notices.template.save", data.title, { id: data.id, kind: data.kind, promoAmount: data.promoAmount });
    refresh();
    return `Текст «${data.title}» сохранён.`;
  });
}

// Где используется текст: правила (по умолчанию) и вайпы, которые ещё не отправлены.
async function usedBy(id: string): Promise<string[]> {
  const [rules, events] = await Promise.all([
    prisma.noticeRule.findMany({ where: { OR: [{ regularTemplateId: id }, { globalTemplateId: id }] }, select: { key: true } }),
    prisma.noticeEvent.findMany({ where: { templateId: id, status: { in: ["pending", "sending", "partial"] } }, select: { key: true } }),
  ]);
  return [...rules.map((r) => `правило «${r.key}»`), ...events.map((e) => `вайп ${e.key}`)];
}

export async function deleteNoticeTemplate(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  return runAction("any", async (user) => {
    const id = str(fd, "id");
    const used = await usedBy(id);
    if (used.length) throw new ActionError(`Текст используется: ${used.join(", ")}. Сначала выбери там другой.`);
    const t = await prisma.noticeTemplate.delete({ where: { id } });
    await audit(user, MODULE, "notices.template.delete", t.title, { id });
    refresh();
    return `Текст «${t.title}» удалён.`;
  });
}

// ---------------------------------------------------------------- расписание

export async function saveNoticeRule(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  return runAction("any", async (user) => {
    const originalKey = optional(fd, "originalKey");
    const anchor = str(fd, "bpAnchor");
    const data = noticeRuleSchema.parse({
      key: str(fd, "key"),
      weekday: int(fd, "weekday"),
      time: str(fd, "time"),
      forceTimezone: optional(fd, "forceTimezone"),
      forceTime: optional(fd, "forceTime"),
      bpFirstOfMonth: bool(fd, "bpFirstOfMonth"),
      bpEveryDays: str(fd, "bpEveryDays") ? int(fd, "bpEveryDays") : 0,
      bpAnchor: /^\d{4}-\d{2}-\d{2}$/.test(anchor) ? new Date(`${anchor}T00:00:00Z`) : null,
      regularTemplateId: optional(fd, "regularTemplateId"),
      globalTemplateId: optional(fd, "globalTemplateId"),
      enabled: bool(fd, "enabled"),
    });
    const problems = noticeRuleProblems(data, await prisma.noticeTemplate.findMany({ select: { id: true, kind: true } }));
    if (problems.length) throw new ActionError(problems.join(". "));
    if (originalKey && originalKey !== data.key) {
      if (await prisma.noticeRule.findUnique({ where: { key: data.key } })) throw new ActionError(`Правило «${data.key}» уже есть`);
      await prisma.$transaction([prisma.noticeRule.delete({ where: { key: originalKey } }), prisma.noticeRule.create({ data })]);
    } else if (!originalKey) {
      if (await prisma.noticeRule.findUnique({ where: { key: data.key } })) throw new ActionError(`Правило «${data.key}» уже есть`);
      await prisma.noticeRule.create({ data });
    } else {
      await prisma.noticeRule.update({ where: { key: data.key }, data });
    }
    await audit(user, MODULE, "notices.rule.save", data.key, { ...data, bpAnchor: data.bpAnchor?.toISOString().slice(0, 10) ?? null });
    refresh();
    return `Правило «${data.key}» сохранено. Вайпы, о которых бот уже спросил, остаются как есть.`;
  });
}

export async function deleteNoticeRule(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  return runAction("any", async (user) => {
    const key = str(fd, "key");
    await prisma.noticeRule.delete({ where: { key } });
    await audit(user, MODULE, "notices.rule.delete", key);
    refresh();
    return `Правило «${key}» удалено.`;
  });
}

// ---------------------------------------------------------------- план дня

export async function saveNoticeAgenda(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  return runAction("any", async (user) => {
    const days: { weekday: number; items: string[] }[] = [];
    for (let weekday = 0; weekday < 7; weekday++) {
      const items = noticeAgendaDaySchema.parse(str(fd, `day${weekday}`).split(/\r?\n/).map((x) => x.trim()).filter(Boolean));
      days.push({ weekday, items });
    }
    await prisma.$transaction(days.map((d) => prisma.noticeAgendaDay.upsert({ where: { weekday: d.weekday }, create: d, update: { items: d.items } })));
    await audit(user, MODULE, "notices.agenda", null, { days: days.map((d) => d.items.length) });
    refresh();
    return "План дня сохранён.";
  });
}

export async function toggleNoticeAgenda(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  return runAction("any", async (user) => {
    const agendaEnabled = str(fd, "enabled") === "1";
    await prisma.noticeSettings.upsert({ where: { id: 1 }, create: { id: 1, agendaEnabled }, update: { agendaEnabled } });
    await audit(user, MODULE, "notices.agenda.toggle", null, { agendaEnabled });
    refresh();
    return agendaEnabled ? "План дня и напоминания включены." : "План дня и напоминания отключены. Уведомления о вайпах работают как раньше.";
  });
}

export async function saveNoticeReminder(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  return runAction("any", async (user) => {
    const data = noticeReminderSchema.parse({
      id: str(fd, "id"),
      title: str(fd, "title"),
      text: str(fd, "text"),
      button: str(fd, "button"),
      doneText: str(fd, "doneText"),
      days: fd.getAll("days").map((v) => Number(v)).filter(Number.isInteger),
      times: parseTimes(str(fd, "times")),
      graceMinutes: int(fd, "graceMinutes"),
      enabled: bool(fd, "enabled"),
      sortOrder: intOrNull(fd, "sortOrder") ?? 0,
    });
    const originalId = optional(fd, "originalId");
    if (originalId && originalId !== data.id) throw new ActionError("ID напоминания менять нельзя: он записан в кнопках уже отправленных сообщений");
    if (originalId) await prisma.noticeReminder.update({ where: { id: data.id }, data });
    else {
      if (await prisma.noticeReminder.findUnique({ where: { id: data.id } })) throw new ActionError(`Напоминание «${data.id}» уже есть`);
      await prisma.noticeReminder.create({ data });
    }
    await audit(user, MODULE, "notices.reminder.save", data.title, { id: data.id, days: data.days, times: data.times });
    refresh();
    return `Напоминание «${data.title}» сохранено.`;
  });
}

export async function deleteNoticeReminder(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  return runAction("any", async (user) => {
    const r = await prisma.noticeReminder.delete({ where: { id: str(fd, "id") } });
    await audit(user, MODULE, "notices.reminder.delete", r.title);
    refresh();
    return `Напоминание «${r.title}» удалено.`;
  });
}

// ---------------------------------------------------------------- картинки

export async function uploadNoticeImage(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  return runAction("any", async (user) => {
    if (!rateLimit(`upload:${user.id}`, 20, 10 * 60_000)) throw new ActionError("Слишком много загрузок. Подожди несколько минут.");
    const kind = str(fd, "kind");
    if (kind !== "regular" && kind !== "global") throw new ActionError("Неизвестный тип вайпа");
    const file = fd.get("file");
    if (!(file instanceof File) || file.size === 0) throw new ActionError("Выбери файл");
    const img = await sanitizePostImage(file);
    const data = { data: new Uint8Array(img.data), mime: img.mime, size: img.data.length, updatedByName: user.username };
    await prisma.noticeImage.upsert({ where: { kind }, create: { kind, ...data }, update: data });
    await audit(user, MODULE, "notices.image", kind === "global" ? "глобальный" : "обычный", { width: img.width, height: img.height, size: img.data.length });
    refresh();
    return `Картинка сохранена: ${img.width}×${img.height}, ${Math.round(img.data.length / 1024)} КБ.`;
  });
}

// ---------------------------------------------------------------- ключи

export async function saveNoticeSecrets(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  return runAction("full", async (user) => {
    const key = await prisma.botPublicKey.findUnique({ where: { botKey: NOTICE_BOT_KEY } });
    if (!key) throw new ActionError("Бот объявлений ещё ни разу не запускался: запусти его, чтобы панель получила ключ шифрования.");
    const changed: string[] = [];
    for (const meta of NOTICE_SECRETS) {
      const value = str(fd, meta.name).trim();
      if (!value) continue; // пустое поле — оставить прежний
      const name = meta.name as NoticeSecretName;
      const problem = noticeSecretProblem(name, value);
      if (problem) throw new ActionError(`${meta.label}: ${problem}`);
      if (name === "telegramToken") {
        const taken = await telegramBotTakenBy(value, "notices");
        if (taken) throw new ActionError(`Этот Telegram-бот уже подключён: ${taken}. Для объявлений нужен отдельный.`);
      }
      const data = {
        valueEnc: sealSecret(key.publicKey, value, noticeSecretContext(name)),
        hint: noticeSecretHint(name, value),
        setAt: new Date(),
        setById: user.id,
        setByName: user.username,
      };
      await prisma.noticeSecret.upsert({ where: { name }, create: { name, ...data }, update: data });
      changed.push(meta.label);
    }
    if (!changed.length) throw new ActionError("Нажми «Заменить» у нужного поля и вставь новое значение.");
    // Значения в журнал не пишем: только что заменили.
    await audit(user, MODULE, "notices.secrets", changed.join(", "));
    revalidatePath("/notices/connection");
    return `Сохранено: ${changed.join(", ")}. Бот подхватит новые значения в течение 5 секунд.`;
  });
}

export async function clearNoticeSecret(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  return runAction("full", async (user) => {
    const meta = NOTICE_SECRETS.find((m) => m.name === str(fd, "name"));
    if (!meta) throw new ActionError("Неизвестный ключ");
    await prisma.noticeSecret.deleteMany({ where: { name: meta.name } });
    await audit(user, MODULE, "notices.secret.clear", meta.label);
    revalidatePath("/notices/connection");
    return `${meta.label}: удалён.`;
  });
}
