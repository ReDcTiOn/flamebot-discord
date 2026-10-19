// Биты прав Discord: https://discord.com/developers/docs/topics/permissions
export const Perm = {
  KickMembers: 1n << 1n,
  BanMembers: 1n << 2n,
  Administrator: 1n << 3n,
  ManageChannels: 1n << 4n,
  ManageGuild: 1n << 5n,
  ViewAuditLog: 1n << 7n,
  ManageMessages: 1n << 13n,
  MentionEveryone: 1n << 17n,
  MuteMembers: 1n << 22n,
  DeafenMembers: 1n << 23n,
  MoveMembers: 1n << 24n,
  ManageNicknames: 1n << 27n,
  ManageRoles: 1n << 28n,
  ManageWebhooks: 1n << 29n,
  ManageGuildExpressions: 1n << 30n,
  ManageEvents: 1n << 33n,
  ManageThreads: 1n << 34n,
  ModerateMembers: 1n << 40n,
} as const;

// Роли с любым из этих прав бот никогда не выдаёт: ни за ранг, ни через магазин.
// Так даже взломанная панель не сможет раздать кому-то модерку или админку.
export const DANGEROUS_PERMISSIONS = Object.values(Perm).reduce((acc, bit) => acc | bit, 0n);

export function parsePermissions(value: string | bigint | null | undefined): bigint {
  if (typeof value === "bigint") return value;
  if (!value || !/^\d+$/.test(value)) return 0n;
  return BigInt(value);
}

export function hasPermission(permissions: bigint, bit: bigint): boolean {
  if ((permissions & Perm.Administrator) === Perm.Administrator) return true;
  return (permissions & bit) === bit;
}

export interface RoleSnapshot {
  id: string;
  permissions: string | bigint;
  managed: boolean;
}

export type RoleSafety = { ok: true } | { ok: false; reason: string };

export function checkRoleSafeToGrant(role: RoleSnapshot | null | undefined, guildId: string): RoleSafety {
  if (!role) return { ok: false, reason: "Роль не найдена на сервере" };
  if (role.id === guildId) return { ok: false, reason: "Роль @everyone выдавать нельзя" };
  if (role.managed) return { ok: false, reason: "Это служебная роль интеграции или бота" };
  if ((parsePermissions(role.permissions) & DANGEROUS_PERMISSIONS) !== 0n) {
    return { ok: false, reason: "У роли есть права модерации или администрирования" };
  }
  return { ok: true };
}
