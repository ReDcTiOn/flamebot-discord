import type { Guild } from "discord.js";
import { prisma } from "@flamebot/core";
import { log } from "../logger.js";

export const BOT_KEY = "rating";

// Пишет в базу снимок ролей и каналов, чтобы панель могла показывать списки,
// не имея токена бота.
export async function syncGuildSnapshot(guild: Guild): Promise<void> {
  try {
    const roles = [...guild.roles.cache.values()];
    const channels = [...guild.channels.cache.values()];

    await prisma.$transaction([
      prisma.guildRole.deleteMany({ where: { id: { notIn: roles.map((r) => r.id) } } }),
      ...roles.map((r) =>
        prisma.guildRole.upsert({
          where: { id: r.id },
          create: {
            id: r.id,
            name: r.name,
            color: r.color,
            position: r.position,
            permissions: r.permissions.bitfield.toString(),
            managed: r.managed,
          },
          update: {
            name: r.name,
            color: r.color,
            position: r.position,
            permissions: r.permissions.bitfield.toString(),
            managed: r.managed,
          },
        }),
      ),
      prisma.guildChannel.deleteMany({ where: { id: { notIn: channels.map((c) => c.id) } } }),
      ...channels.map((c) => {
        const data = {
          name: c.name,
          type: c.type,
          position: "position" in c ? c.position : 0,
          parentId: c.parentId,
        };
        return prisma.guildChannel.upsert({ where: { id: c.id }, create: { id: c.id, ...data }, update: data });
      }),
    ]);
  } catch (err) {
    log.error("Не удалось сохранить снимок ролей и каналов", err);
  }
}

export async function heartbeat(guild: Guild): Promise<void> {
  const info = {
    name: guild.name,
    iconHash: guild.icon,
    ownerId: guild.ownerId,
    memberCount: guild.memberCount,
  };
  try {
    await prisma.$transaction([
      prisma.guildInfo.upsert({ where: { id: 1 }, create: { id: 1, ...info }, update: info }),
      prisma.botStatus.upsert({
        where: { botKey: BOT_KEY },
        create: { botKey: BOT_KEY, heartbeatAt: new Date() },
        update: { heartbeatAt: new Date() },
      }),
    ]);
  } catch (err) {
    log.warn("Не удалось записать статус бота", err);
  }
}

let timer: NodeJS.Timeout | null = null;

// Роли и каналы могут меняться пачкой, поэтому сохраняем снимок с задержкой.
export function scheduleSnapshot(guild: Guild): void {
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => {
    timer = null;
    void syncGuildSnapshot(guild);
  }, 3000);
}
