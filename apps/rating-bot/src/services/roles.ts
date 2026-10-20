import type { Guild, GuildMember, Role } from "discord.js";
import { checkRoleSafeToGrant, type RoleSafety } from "@flamebot/core";
import { log } from "../logger.js";
import { event } from "./events.js";

// Проверка по живой роли с сервера, а не по снимку в базе.
export function checkLiveRole(guild: Guild, roleId: string | null | undefined): RoleSafety & { role?: Role } {
  if (!roleId) return { ok: false, reason: "Роль не задана" };
  const role = guild.roles.cache.get(roleId);
  const safety = checkRoleSafeToGrant(
    role ? { id: role.id, permissions: role.permissions.bitfield, managed: role.managed } : null,
    guild.id,
  );
  if (!safety.ok) return safety;
  if (!role!.editable) {
    return { ok: false, reason: "Роль стоит выше роли бота, бот не может её выдать" };
  }
  return { ok: true, role: role! };
}

export async function grantRole(member: GuildMember, roleId: string, reason: string): Promise<RoleSafety> {
  const check = checkLiveRole(member.guild, roleId);
  if (!check.ok) {
    console.warn(`Отказ в выдаче роли ${roleId} пользователю ${member.id}: ${check.reason}`);
    event("role.denied", `Бот не выдал роль ${roleId} игроку ${member.displayName}: ${check.reason}`, {
      level: "WARN",
      memberId: member.id,
      details: { roleId, reason: check.reason },
    });
    return check;
  }
  if (!member.roles.cache.has(roleId)) await member.roles.add(roleId, reason);
  return { ok: true };
}

export async function revokeRole(member: GuildMember, roleId: string, reason: string): Promise<void> {
  const role = member.guild.roles.cache.get(roleId);
  if (!role || !role.editable || !member.roles.cache.has(roleId)) return;
  await member.roles.remove(roleId, reason);
}
