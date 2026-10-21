import { Perm, getPanelSettings, parsePermissions, prisma } from "@flamebot/core";
import type { DiscordGuildAccess } from "./discord";
import { env } from "./env";

export type AccessLevel = "full" | "manager" | null;

// full    — владелец сервера или роль с правом «Администратор»: всё, включая управление доступом.
// manager — право «Управлять сервером» или роль из списка панели: всё, кроме управления доступом.
// Владельца и права берём у самого Discord (discord). Если Discord их не дал (старая сессия),
// права считаются по снимку ролей, который пишет бот. Роли из списка панели — по ролям участника.
export async function computeAccess(
  userId: string,
  memberRoleIds: string[],
  discord: DiscordGuildAccess | null,
): Promise<AccessLevel> {
  const guildId = env().GUILD_ID;
  const [guild, panel, roles] = await Promise.all([
    prisma.guildInfo.findUnique({ where: { id: 1 } }),
    getPanelSettings(prisma),
    prisma.guildRole.findMany({ where: { id: { in: [guildId, ...memberRoleIds] } } }),
  ]);

  if (discord?.owner || guild?.ownerId === userId) return "full";

  let perms = 0n;
  if (discord) perms = discord.permissions;
  else for (const role of roles) perms |= parsePermissions(role.permissions);

  if ((perms & Perm.Administrator) === Perm.Administrator) return "full";
  if ((perms & Perm.ManageGuild) === Perm.ManageGuild) return "manager";
  if (memberRoleIds.some((id) => panel.panelRoleIds.includes(id))) return "manager";
  return null;
}
