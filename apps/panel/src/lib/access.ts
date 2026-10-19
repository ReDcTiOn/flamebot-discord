import { Perm, getPanelSettings, parsePermissions, prisma } from "@flamebot/core";
import { env } from "./env";

export type AccessLevel = "full" | "manager" | null;

// full    — владелец сервера или роль с правом «Администратор»: всё, включая управление доступом.
// manager — право «Управлять сервером» или роль из списка панели: всё, кроме управления доступом.
// Права считаются по снимку ролей, который пишет бот. Если снимка нет, доступа нет ни у кого,
// кроме владельца.
export async function computeAccess(userId: string, memberRoleIds: string[]): Promise<AccessLevel> {
  const guildId = env().GUILD_ID;
  const [guild, panel, roles] = await Promise.all([
    prisma.guildInfo.findUnique({ where: { id: 1 } }),
    getPanelSettings(prisma),
    prisma.guildRole.findMany({ where: { id: { in: [guildId, ...memberRoleIds] } } }),
  ]);

  if (guild?.ownerId === userId) return "full";

  let perms = 0n;
  for (const role of roles) perms |= parsePermissions(role.permissions);

  if ((perms & Perm.Administrator) === Perm.Administrator) return "full";
  if ((perms & Perm.ManageGuild) === Perm.ManageGuild) return "manager";
  if (memberRoleIds.some((id) => panel.panelRoleIds.includes(id))) return "manager";
  return null;
}
