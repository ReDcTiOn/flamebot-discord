import { z } from "zod";
import type { PanelSettings } from "@prisma/client";
import type { Db } from "./db.js";
import type { RatingSettings } from "./types.js";

export const SNOWFLAKE = /^\d{17,20}$/;
export const snowflake = z.string().regex(SNOWFLAKE, "Неверный Discord ID");

const snowflakeList = z.array(snowflake).max(100);

// Границы значений задаются здесь, чтобы и панель, и бот проверяли одно и то же.
// Число с точностью до сотых: 0.01, 2.5, 15.
const hundredths = (min: number, max: number) =>
  z
    .number()
    .min(min)
    .max(max)
    .refine((v) => Math.abs(Math.round(v * 100) - v * 100) < 1e-6, "Не больше двух знаков после запятой");

export const xpSettingsSchema = z
  .object({
    xpMin: hundredths(0, 1000),
    xpMax: hundredths(0, 1000),
    xpCooldownSec: z.number().int().min(5).max(3600),
    minMessageLength: z.number().int().min(0).max(500),
    scrapPerAward: hundredths(0, 1000),
    announceRankUp: z.boolean(),
    removeOldRankRoles: z.boolean(),
  })
  .refine((v) => v.xpMax >= v.xpMin, {
    message: "Максимум опыта не может быть меньше минимума",
    path: ["xpMax"],
  });

export const repSettingsSchema = z.object({
  repCooldownHours: z.number().int().min(1).max(24 * 30),
  repSameTargetDays: z.number().int().min(0).max(365),
  repMinMemberDays: z.number().int().min(0).max(365),
});

export const channelSettingsSchema = z.object({
  announceChannelId: snowflake.nullable(),
  xpChannelIds: snowflakeList,
  commandChannelIds: snowflakeList,
});

export const customRoleSettingsSchema = z
  .object({
    customRoleApproval: z.boolean(),
    approvalChannelId: snowflake.nullable(),
  })
  .refine((v) => !v.customRoleApproval || v.approvalChannelId, {
    message: "Выбери канал, куда будут приходить заявки",
    path: ["approvalChannelId"],
  });

export const messageSettingsSchema = z.object({
  rankUpMessage: z.string().trim().min(1).max(500),
});

export const accessSettingsSchema = z.object({
  panelRoleIds: snowflakeList,
});

export const rankSchema = z
  .object({
    name: z.string().trim().min(1).max(50),
    emoji: z.string().trim().max(32).nullable(),
    minXp: z.number().int().min(0).max(100_000_000),
    roleId: snowflake.nullable(),
    scrapReward: z.number().int().min(0).max(1_000_000),
    // Своё начисление за сообщение на этом ранге; null — как в общих настройках.
    xpMin: hundredths(0, 1000).nullable(),
    xpMax: hundredths(0, 1000).nullable(),
    scrapPerMessage: hundredths(0, 1000).nullable(),
  })
  .refine((v) => (v.xpMin === null) === (v.xpMax === null), {
    message: "Укажи опыт за сообщение «от» и «до» или оставь оба поля пустыми",
    path: ["xpMax"],
  })
  .refine((v) => v.xpMin === null || v.xpMax === null || v.xpMax >= v.xpMin, {
    message: "Максимум опыта не может быть меньше минимума",
    path: ["xpMax"],
  });

export const shopItemSchema = z
  .object({
    name: z.string().trim().min(1).max(80),
    description: z.string().trim().max(200),
    type: z.enum(["ROLE", "CUSTOM_ROLE", "BADGE"]),
    price: z.number().int().min(1).max(10_000_000),
    roleId: snowflake.nullable(),
    durationDays: z.number().int().min(1).max(3650).nullable(),
    badgeLabel: z.string().trim().min(1).max(40).nullable(),
    enabled: z.boolean(),
    stock: z.number().int().min(0).max(1_000_000).nullable(),
    sortOrder: z.number().int().min(-1000).max(1000),
  })
  .superRefine((v, ctx) => {
    if (v.type === "ROLE" && !v.roleId) {
      ctx.addIssue({ code: "custom", message: "Выбери роль для товара", path: ["roleId"] });
    }
    if (v.type === "BADGE" && !v.badgeLabel) {
      ctx.addIssue({ code: "custom", message: "Укажи текст бейджа", path: ["badgeLabel"] });
    }
  });

export const memberAdjustSchema = z.object({
  memberId: snowflake,
  field: z.enum(["xp", "scrap", "rep"]),
  delta: hundredths(-10_000_000, 10_000_000),
  reason: z.string().trim().min(3).max(200),
});

export async function getRatingSettings(db: Db): Promise<RatingSettings> {
  return db.ratingSettings.upsert({ where: { id: 1 }, update: {}, create: { id: 1 } });
}

export async function getPanelSettings(db: Db): Promise<PanelSettings> {
  return db.panelSettings.upsert({ where: { id: 1 }, update: {}, create: { id: 1 } });
}

// Стартовые ранги FLAME RUST: создаются, только если в базе ещё нет ни одного ранга.
// roleId — роли нашего Discord-сервера. На другом сервере таких ролей нет: бот их не выдаст,
// запишет предупреждение в историю, а роли можно переназначить в панели.
// xpMin/xpMax/scrapPerMessage — начисление за одно сообщение на этом ранге.
export const DEFAULT_RANKS = [
  { name: "Фармила", emoji: null, minXp: 50, scrapReward: 5, xpMin: 0.02, xpMax: 0.03, scrapPerMessage: 0.05, roleId: "1333079670098497647" },
  { name: "Билдер", emoji: "🩲", minXp: 100, scrapReward: 7, xpMin: 0.03, xpMax: 0.04, scrapPerMessage: 0.07, roleId: "1333079839569346661" },
  { name: "Стрелок", emoji: "🌾", minXp: 300, scrapReward: 10, xpMin: 0.04, xpMax: 0.05, scrapPerMessage: 0.09, roleId: "1333079985124020296" },
  { name: "Рейдер", emoji: "🪵", minXp: 500, scrapReward: 15, xpMin: 0.05, xpMax: 0.06, scrapPerMessage: 0.12, roleId: "1333080059157938189" },
  { name: "Комбатер", emoji: "🪨", minXp: 700, scrapReward: 20, xpMin: 0.05, xpMax: 0.06, scrapPerMessage: 0.15, roleId: "1333080086986887258" },
  { name: "Руфкемпер", emoji: "⚙️", minXp: 1000, scrapReward: 50, xpMin: 0.07, xpMax: 0.08, scrapPerMessage: 0.18, roleId: "1333080151172321362" },
  { name: "Сигма раста", emoji: "💎", minXp: 1500, scrapReward: 100, xpMin: 0.08, xpMax: 0.09, scrapPerMessage: 0.21, roleId: "1333080205593411676" },
] as const;

// Создаёт настройки и стартовые ранги, если база пустая.
export async function ensureRatingDefaults(db: Db): Promise<void> {
  await getRatingSettings(db);
  const count = await db.rank.count();
  if (count === 0) {
    await db.rank.createMany({ data: DEFAULT_RANKS.map((r) => ({ ...r })), skipDuplicates: true });
  }
}
