"use server";

import { revalidatePath } from "next/cache";
import {
  MAPS_BOT_KEY,
  MAPS_SECRETS,
  mapsRuleProblems,
  mapsRuleSchema,
  mapsScoringSchema,
  mapsSecretContext,
  mapsSecretHint,
  mapsSecretProblem,
  mapsServerSchema,
  mapsSettingsSchema,
  MONUMENT_CHECKLIST,
  Prisma,
  prisma,
  sealSecret,
  type MapsSecretName,
} from "@flamebot/core";
import { ActionError, audit, runAction, type ActionResult } from "@/lib/auth";
import { bool, int, str } from "@/lib/form";
import { MAPS_ACTION_KINDS, MAPS_ACTION_LABEL, runBotAction, type MapsActionKind } from "@/lib/maps";

const MODULE = MAPS_BOT_KEY;

const num = (fd: FormData, name: string) => {
  const raw = str(fd, name).trim().replace(",", ".");
  if (!/^\d+(\.\d+)?$/.test(raw)) throw new ActionError("Числовые поля — неотрицательные числа, например 24 или 0.5");
  return Number(raw);
};
const optional = (fd: FormData, name: string) => str(fd, name).trim() || null;

// Задание боту: кнопки на странице вайпа и проверка подключений.
export async function mapsAction(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  return runAction("any", async (user) => {
    const kind = str(fd, "kind") as MapsActionKind;
    if (!(MAPS_ACTION_KINDS as readonly string[]).includes(kind)) throw new ActionError("Неизвестное действие");
    const args: Record<string, string | number> = {};
    for (const name of ["cycleId", "wipeId"]) if (str(fd, name)) args[name] = str(fd, name).slice(0, 64);
    if (str(fd, "slotId")) args.slotId = int(fd, "slotId");
    if (kind === "slot.manual") {
      const url = str(fd, "url").trim();
      const viewUrl = str(fd, "viewUrl").trim();
      if (!/^https?:\/\/\S+$/i.test(url)) throw new ActionError("Нужна прямая ссылка на файл .map (http или https)");
      if (viewUrl && !/^https?:\/\/\S+$/i.test(viewUrl)) throw new ActionError("Ссылка на страницу карты должна начинаться с http или https");
      args.url = url.slice(0, 1000);
      if (viewUrl) args.viewUrl = viewUrl.slice(0, 1000);
    }
    // Проверка и чтение Pterodactyl идут по сети дольше остальных.
    const timeout = kind === "check" || kind === "ptero.status" || kind === "ptero.apply" ? 45_000 : 15_000;
    const result = await runBotAction(kind, args, user, timeout);
    // Сами действия бот пишет в историю; в журнал панели — кто и что попросил.
    await audit(user, MODULE, `maps.${kind}`, MAPS_ACTION_LABEL[kind] ?? kind, { ...args, ...(args.url ? { url: "ссылка" } : {}) } as Prisma.InputJsonValue);
    revalidatePath("/maps", "layout");
    if (!result.ok) throw new ActionError(result.text);
    return result.text;
  });
}

export async function saveMapsSettings(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  return runAction("any", async (user) => {
    const data = mapsSettingsSchema.parse({
      timezone: str(fd, "timezone"),
      timezoneLabel: str(fd, "timezoneLabel"),
      sendLeadHours: num(fd, "sendLeadHours"),
      genLeadHours: num(fd, "genLeadHours"),
      autoPick: bool(fd, "autoPick"),
      panelAskHours: int(fd, "panelAskHours"),
      panelRemindMinutes: int(fd, "panelRemindMinutes"),
      panelAutoMinutes: int(fd, "panelAutoMinutes"),
      telegramAdminIds: str(fd, "telegramAdminIds")
        .split(/[\s,;]+/)
        .filter(Boolean),
      telegramChatId: optional(fd, "telegramChatId"),
      rustmapsOrgId: optional(fd, "rustmapsOrgId"),
      s3Endpoint: str(fd, "s3Endpoint").trim(),
      s3Region: str(fd, "s3Region"),
      s3Bucket: str(fd, "s3Bucket"),
      s3Prefix: str(fd, "s3Prefix"),
      s3Addressing: str(fd, "s3Addressing"),
      cdnBaseUrl: str(fd, "cdnBaseUrl").trim(),
      pteroUrl: optional(fd, "pteroUrl"),
    });
    await prisma.mapsSettings.upsert({ where: { id: 1 }, create: { id: 1, ...data }, update: data });
    await audit(user, MODULE, "maps.settings", null, data);
    revalidatePath("/maps", "layout");
    return "Настройки сохранены. Бот применит их в течение 5 секунд.";
  });
}

export async function toggleMapsAutoPick(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  return runAction("any", async (user) => {
    const autoPick = bool(fd, "autoPick");
    await prisma.mapsSettings.update({ where: { id: 1 }, data: { autoPick } });
    await audit(user, MODULE, "maps.autopick", autoPick ? "включён" : "выключен");
    revalidatePath("/maps", "layout");
    return autoPick ? "Автоподбор включён: для новых вайпов бот сам предложит набор карт." : "Автоподбор выключен: карты выбираются по карточкам серверов.";
  });
}

// ---------------------------------------------------------------- серверы
export async function saveMapsServer(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  return runAction("any", async (user) => {
    const originalId = str(fd, "originalId") ? int(fd, "originalId") : null;
    const data = mapsServerSchema.parse({
      id: int(fd, "id"),
      title: str(fd, "title"),
      folder: str(fd, "folder"),
      size: int(fd, "size"),
      savedConfig: str(fd, "savedConfig"),
      pteroUuid: optional(fd, "pteroUuid"),
    });
    if (originalId !== null && originalId !== data.id) {
      // Номер сервера — ключ в правилах и в истории карт. Менять его можно, только если сервер нигде не используется.
      const used = await prisma.mapsWipeRule.count({ where: { serverIds: { has: originalId } } });
      if (used) throw new ActionError("Номер сервера используется в расписании: сначала убери сервер из правил");
      await prisma.$transaction([prisma.mapsServer.delete({ where: { id: originalId } }), prisma.mapsServer.create({ data })]);
    } else if (originalId === null) {
      if (await prisma.mapsServer.findUnique({ where: { id: data.id } })) throw new ActionError(`Сервер #${data.id} уже есть`);
      await prisma.mapsServer.create({ data });
    } else {
      await prisma.mapsServer.update({ where: { id: data.id }, data });
    }
    await audit(user, MODULE, "maps.server.save", data.title, data);
    revalidatePath("/maps", "layout");
    return `Сервер «${data.title}» сохранён.`;
  });
}

export async function deleteMapsServer(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  return runAction("any", async (user) => {
    const id = int(fd, "id");
    const rules = await prisma.mapsWipeRule.findMany({ where: { serverIds: { has: id } }, select: { key: true } });
    if (rules.length) throw new ActionError(`Сервер есть в правилах расписания: ${rules.map((r) => r.key).join(", ")}. Сначала убери его оттуда.`);
    const s = await prisma.mapsServer.delete({ where: { id } });
    await audit(user, MODULE, "maps.server.delete", s.title);
    revalidatePath("/maps", "layout");
    return `Сервер «${s.title}» удалён.`;
  });
}

// ---------------------------------------------------------------- расписание
export async function saveMapsRule(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  return runAction("any", async (user) => {
    const originalKey = str(fd, "originalKey") || null;
    let template: unknown;
    try {
      template = JSON.parse(str(fd, "template"));
    } catch {
      throw new ActionError("Шаблон анонса — это JSON тела сообщения вебхука. Проверь скобки и кавычки.");
    }
    const serverIds = fd.getAll("serverIds").map((v) => Number(v)).filter(Number.isInteger);
    const pool: Record<string, number> = {};
    for (const [k, v] of fd.entries()) {
      if (k.startsWith("pool:") && typeof v === "string" && v.trim()) pool[k.slice(5)] = Number(v);
    }
    const anchor = str(fd, "bpAnchor");
    const data = mapsRuleSchema.parse({
      key: str(fd, "key"),
      weekday: int(fd, "weekday"),
      time: str(fd, "time"),
      serverIds,
      pool,
      template,
      forceTimezone: optional(fd, "forceTimezone"),
      forceTime: optional(fd, "forceTime"),
      bpFirstOfMonth: bool(fd, "bpFirstOfMonth"),
      bpEveryDays: str(fd, "bpEveryDays") ? int(fd, "bpEveryDays") : 0,
      bpAnchor: /^\d{4}-\d{2}-\d{2}$/.test(anchor) ? new Date(`${anchor}T00:00:00Z`) : null,
      enabled: bool(fd, "enabled"),
    });
    const servers = await prisma.mapsServer.findMany();
    const problems = mapsRuleProblems(data, servers);
    if (problems.length) throw new ActionError(problems.join(". "));
    const row = { ...data, pool: data.pool as Prisma.InputJsonValue, template: data.template as Prisma.InputJsonValue };
    if (originalKey && originalKey !== data.key) {
      if (await prisma.mapsWipeRule.findUnique({ where: { key: data.key } })) throw new ActionError(`Правило «${data.key}» уже есть`);
      await prisma.$transaction([prisma.mapsWipeRule.delete({ where: { key: originalKey } }), prisma.mapsWipeRule.create({ data: row })]);
    } else if (!originalKey) {
      if (await prisma.mapsWipeRule.findUnique({ where: { key: data.key } })) throw new ActionError(`Правило «${data.key}» уже есть`);
      await prisma.mapsWipeRule.create({ data: row });
    } else {
      await prisma.mapsWipeRule.update({ where: { key: data.key }, data: row });
    }
    await audit(user, MODULE, "maps.rule.save", data.key, { ...data, template: "шаблон" } as Prisma.InputJsonValue);
    revalidatePath("/maps", "layout");
    return `Правило «${data.key}» сохранено. Вайпы, где генерация уже идёт, работают по старым значениям.`;
  });
}

export async function deleteMapsRule(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  return runAction("any", async (user) => {
    const key = str(fd, "key");
    await prisma.mapsWipeRule.delete({ where: { key } });
    await audit(user, MODULE, "maps.rule.delete", key);
    revalidatePath("/maps", "layout");
    return `Правило «${key}» удалено. Новые вайпы по нему не начнутся.`;
  });
}

// ---------------------------------------------------------------- оценка карт
export async function saveMapsScoring(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  return runAction("any", async (user) => {
    const rtWeights: Record<string, number> = {};
    for (const [name] of MONUMENT_CHECKLIST) rtWeights[name] = int(fd, `w:${name}`);
    const data = mapsScoringSchema.parse({
      parts: { rt: int(fd, "rt"), spread: int(fd, "spread"), terrain: int(fd, "terrain"), extra: int(fd, "extra") },
      rtWeights,
    });
    await prisma.mapsSettings.update({ where: { id: 1 }, data: { scoring: data as unknown as Prisma.InputJsonValue } });
    await audit(user, MODULE, "maps.scoring", null, data as unknown as Prisma.InputJsonValue);
    revalidatePath("/maps", "layout");
    return "Веса оценки сохранены. Новые оценки посчитаются по ним.";
  });
}

export async function resetMapsScoring(_prev: ActionResult, _fd: FormData): Promise<ActionResult> {
  return runAction("any", async (user) => {
    await prisma.mapsSettings.update({ where: { id: 1 }, data: { scoring: Prisma.DbNull } });
    await audit(user, MODULE, "maps.scoring.reset", null);
    revalidatePath("/maps", "layout");
    return "Веса оценки сброшены к значениям по умолчанию.";
  });
}

// ---------------------------------------------------------------- секреты
// Секреты шифруются открытым ключом бота сразу при сохранении. Прочитать их панель не может.
export async function saveMapsSecrets(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  return runAction("full", async (user) => {
    const key = await prisma.botPublicKey.findUnique({ where: { botKey: MAPS_BOT_KEY } });
    if (!key) throw new ActionError("Бот карт ещё ни разу не запускался: запусти его, чтобы панель получила ключ шифрования.");
    const changed: string[] = [];
    for (const meta of MAPS_SECRETS) {
      const value = str(fd, meta.name).trim();
      if (!value) continue; // пустое поле — оставить прежний
      const problem = mapsSecretProblem(meta.name as MapsSecretName, value);
      if (problem) throw new ActionError(`${meta.label}: ${problem}`);
      // Тот же Telegram-бот у бота онлайна: двое не могут читать его сообщения, кнопки перестали бы работать.
      if (meta.name === "telegramToken") {
        const online = await prisma.onlineTelegram.findUnique({ where: { id: 1 }, select: { tokenHint: true } });
        if (online?.tokenHint?.match(/\d{5,15}/)?.[0] === value.split(":")[0]) {
          throw new ActionError("Этот Telegram-бот уже подключён к уведомлениям об онлайне серверов. Для бота карт нужен отдельный.");
        }
      }
      const data = {
        valueEnc: sealSecret(key.publicKey, value, mapsSecretContext(meta.name as MapsSecretName)),
        hint: mapsSecretHint(meta.name as MapsSecretName, value),
        setAt: new Date(),
        setById: user.id,
        setByName: user.username,
      };
      await prisma.mapsSecret.upsert({ where: { name: meta.name }, create: { name: meta.name, ...data }, update: data });
      changed.push(meta.label);
    }
    if (!changed.length) throw new ActionError("Нажми «Заменить» у нужного поля и вставь новое значение.");
    // Значения в журнал не пишем: только что заменили.
    await audit(user, MODULE, "maps.secrets", changed.join(", "));
    revalidatePath("/maps/connection");
    return `Сохранено: ${changed.join(", ")}. Бот подхватит новые значения в течение 5 секунд.`;
  });
}

export async function clearMapsSecret(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  return runAction("full", async (user) => {
    const name = str(fd, "name");
    const meta = MAPS_SECRETS.find((m) => m.name === name);
    if (!meta) throw new ActionError("Неизвестный секрет");
    await prisma.mapsSecret.deleteMany({ where: { name } });
    await audit(user, MODULE, "maps.secret.clear", meta.label);
    revalidatePath("/maps/connection");
    return `${meta.label}: удалён.`;
  });
}
