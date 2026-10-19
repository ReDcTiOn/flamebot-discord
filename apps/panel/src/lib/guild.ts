import { checkRoleSafeToGrant, prisma, type GuildRole } from "@flamebot/core";
import { ActionError } from "./auth";
import { env } from "./env";

// Типы каналов Discord, в которые можно писать текстом.
export const TEXT_CHANNEL_TYPES = [0, 5, 15] as const; // текстовый, новости, форум

export async function listRoles(): Promise<(GuildRole & { safe: boolean; reason?: string })[]> {
  const roles = await prisma.guildRole.findMany({ orderBy: { position: "desc" } });
  const guildId = env().GUILD_ID;
  return roles
    .filter((r) => r.id !== guildId)
    .map((r) => {
      const check = checkRoleSafeToGrant(r, guildId);
      return { ...r, safe: check.ok, reason: check.ok ? undefined : check.reason };
    });
}

export async function listTextChannels() {
  return prisma.guildChannel.findMany({
    where: { type: { in: [...TEXT_CHANNEL_TYPES] } },
    orderBy: [{ position: "asc" }, { name: "asc" }],
  });
}

// Роль для выдачи ботом проверяется в панели по снимку и ещё раз ботом по живым данным.
export async function assertGrantableRole(roleId: string | null): Promise<void> {
  if (!roleId) return;
  const role = await prisma.guildRole.findUnique({ where: { id: roleId } });
  const check = checkRoleSafeToGrant(role, env().GUILD_ID);
  if (!check.ok) throw new ActionError(check.reason);
}

export async function assertChannels(channelIds: (string | null)[]): Promise<void> {
  const list = channelIds.filter((c): c is string => !!c);
  if (list.length === 0) return;
  const found = await prisma.guildChannel.count({ where: { id: { in: list } } });
  if (found !== new Set(list).size) throw new ActionError("Один из каналов не найден на сервере");
}

export function roleColor(color: number): string {
  return color ? `#${color.toString(16).padStart(6, "0")}` : "var(--text-muted)";
}
