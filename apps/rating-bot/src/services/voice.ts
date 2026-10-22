import type { Guild, GuildMember } from "discord.js";
import { prisma, round2, startOfUtcDay } from "@flamebot/core";
import { log } from "../logger.js";
import { getState } from "../state.js";
import { announceRankUp, applyRank } from "./ranks.js";

// Опыт за голос, как в JuniperBot. Раз в минуту смотрим голосовые каналы (кроме AFK):
// считаются только люди с включённым микрофоном, боты не считаются. Если таких в канале хотя бы двое,
// каждый получает voiceXpPerMember опыта за каждого из них (считая себя) за минуту
// и время в голосе. Заглушённые и одиночки ничего не получают.

let lastTick = Date.now();

export async function processVoice(guild: Guild): Promise<void> {
  const now = Date.now();
  // Пропущенный такт (бот был занят или перезапускался) не превращаем в лишние минуты.
  const elapsed = Math.min(now - lastTick, 120_000);
  lastTick = now;
  if (elapsed < 10_000) return;

  const byChannel = new Map<string, GuildMember[]>();
  for (const vs of guild.voiceStates.cache.values()) {
    if (!vs.channelId || vs.channelId === guild.afkChannelId) continue;
    const member = vs.member;
    // mute — микрофон выключен сам или администратором; suppress — слушатель на трибуне.
    if (!member || member.user.bot || vs.mute || vs.suppress) continue;
    const list = byChannel.get(vs.channelId) ?? [];
    list.push(member);
    byChannel.set(vs.channelId, list);
  }

  const { settings, ranks } = await getState();
  const minutes = elapsed / 60_000;
  const seconds = Math.round(elapsed / 1000);
  let awarded = 0;

  for (const speaking of byChannel.values()) {
    if (speaking.length < 2) continue;
    const gain = settings.voiceXpEnabled ? Math.round(settings.voiceXpPerMember * speaking.length * minutes) : 0;
    for (const member of speaking) {
      try {
        const fields = {
          username: member.user.username.slice(0, 64),
          displayName: member.displayName.slice(0, 64),
          avatarHash: member.user.avatar,
        };
        const row = await prisma.member.upsert({
          where: { id: member.id },
          create: { id: member.id, ...fields, xp: gain, voiceXp: gain, voiceSeconds: seconds },
          update: { ...fields, inGuild: true, xp: { increment: gain }, voiceXp: { increment: gain }, voiceSeconds: { increment: seconds } },
        });
        if (gain <= 0) continue;
        awarded += gain;
        const { promotedTo, reward } = await applyRank(member, row, settings, ranks);
        if (promotedTo) await announceRankUp(member, promotedTo, reward, settings, null);
      } catch (err) {
        log.warn(`Не удалось начислить опыт за голос ${member.id}`, err);
      }
    }
  }

  if (awarded > 0) {
    const day = startOfUtcDay();
    await prisma.dailyStat.upsert({
      where: { date: day },
      create: { date: day, xpAwarded: round2(awarded) },
      update: { xpAwarded: { increment: round2(awarded) } },
    });
  }
}
