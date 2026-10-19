import type { GuildMember, User } from "discord.js";
import { prisma, type Member } from "@flamebot/core";

function profileFields(user: User, member?: GuildMember | null) {
  return {
    username: user.username.slice(0, 64),
    displayName: (member?.displayName ?? user.globalName ?? user.username).slice(0, 64),
    avatarHash: user.avatar,
  };
}

export async function ensureMember(user: User, member?: GuildMember | null): Promise<Member> {
  const fields = profileFields(user, member);
  return prisma.member.upsert({
    where: { id: user.id },
    create: { id: user.id, ...fields },
    update: { ...fields, inGuild: true },
  });
}

export async function topPosition(xp: number): Promise<number> {
  const higher = await prisma.member.count({ where: { xp: { gt: xp }, inGuild: true } });
  return higher + 1;
}
