import type { Message } from "discord.js";
import { messageReward, prisma, randomHundredths, rankForXp, round2, startOfUtcDay } from "@flamebot/core";
import { config } from "../config.js";
import { log } from "../logger.js";
import { getState } from "../state.js";
import { announceRankUp, applyRank } from "./ranks.js";

const lastAward = new Map<string, number>();

setInterval(
  () => {
    const cutoff = Date.now() - 3_600_000;
    for (const [id, t] of lastAward) if (t < cutoff) lastAward.delete(id);
  },
  600_000,
).unref();

export async function handleMessageXp(message: Message): Promise<void> {
  if (!message.inGuild() || message.guildId !== config.GUILD_ID) return;
  if (message.author.bot || message.webhookId || message.system) return;
  if (!message.member) return;

  const { settings, ranks } = await getState();

  const channel = message.channel;
  const parentId = channel.isThread() ? channel.parentId : null;
  // Пустой список — опыт везде. Иначе только в выбранных каналах и их ветках (треды, посты форума).
  const allowed = settings.xpChannelIds;
  if (allowed.length > 0 && !allowed.includes(channel.id) && !(parentId && allowed.includes(parentId))) {
    return;
  }
  const content = message.content.trim();
  if (content.length < settings.minMessageLength) return;

  const now = Date.now();
  const prev = lastAward.get(message.author.id) ?? 0;
  if (now - prev < settings.xpCooldownSec * 1000) return;
  lastAward.set(message.author.id, now);

  const user = message.author;

  try {
    // Сколько дать, зависит от текущего ранга игрока: у ранга может быть своё начисление.
    const current = await prisma.member.findUnique({ where: { id: user.id }, select: { xp: true, rankId: true } });
    const rank = current ? (ranks.find((r) => r.id === current.rankId) ?? rankForXp(ranks, current.xp)) : rankForXp(ranks, 0);
    const perMessage = messageReward(settings, rank);
    const gain = randomHundredths(perMessage.xpMin, perMessage.xpMax);
    const scrap = round2(perMessage.scrap);

    const row = await prisma.member.upsert({
      where: { id: user.id },
      create: {
        id: user.id,
        username: user.username.slice(0, 64),
        displayName: message.member.displayName.slice(0, 64),
        avatarHash: user.avatar,
        xp: gain,
        scrap,
        messageCount: 1,
        lastXpAt: new Date(now),
      },
      update: {
        username: user.username.slice(0, 64),
        displayName: message.member.displayName.slice(0, 64),
        avatarHash: user.avatar,
        inGuild: true,
        xp: { increment: gain },
        scrap: { increment: scrap },
        messageCount: { increment: 1 },
        lastXpAt: new Date(now),
      },
    });

    const day = startOfUtcDay();
    await prisma.dailyStat.upsert({
      where: { date: day },
      create: { date: day, messages: 1, xpAwarded: gain },
      update: { messages: { increment: 1 }, xpAwarded: { increment: gain } },
    });

    const { promotedTo, reward } = await applyRank(message.member, row, settings, ranks);
    if (promotedTo) await announceRankUp(message.member, promotedTo, reward, settings, channel);
  } catch (err) {
    log.error("Ошибка начисления опыта", err);
  }
}
