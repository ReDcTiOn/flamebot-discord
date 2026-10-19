import { MessageFlags, type Interaction, type RepliableInteraction } from "discord.js";
import { config } from "./config.js";
import { commands } from "./commands/index.js";
import { log } from "./logger.js";
import { getState } from "./state.js";
import { RateLimiter } from "./util.js";

const byName = new Map(commands.map((c) => [c.data.name, c]));
const byPrefix = new Map(commands.filter((c) => c.componentPrefix).map((c) => [c.componentPrefix!, c]));

// Не больше 5 действий за 10 секунд от одного человека.
const limiter = new RateLimiter(5, 10_000);

async function safeReply(interaction: RepliableInteraction, content: string) {
  try {
    if (interaction.deferred || interaction.replied) await interaction.editReply({ content, embeds: [], components: [] });
    else await interaction.reply({ content, flags: MessageFlags.Ephemeral });
  } catch {
    // Взаимодействие могло истечь, тут уже ничего не сделать.
  }
}

export async function handleInteraction(interaction: Interaction): Promise<void> {
  if (!interaction.inCachedGuild() || interaction.guildId !== config.GUILD_ID) return;
  if (!interaction.isRepliable()) return;

  if (!limiter.take(interaction.user.id)) {
    await safeReply(interaction, "Слишком часто. Подожди пару секунд.");
    return;
  }

  try {
    if (interaction.isChatInputCommand()) {
      const command = byName.get(interaction.commandName);
      if (!command) return;

      const { settings } = await getState();
      const allowed = settings.commandChannelIds;
      const channelId = interaction.channel?.isThread() ? interaction.channel.parentId : interaction.channelId;
      if (allowed.length > 0 && !allowed.includes(interaction.channelId) && !(channelId && allowed.includes(channelId))) {
        await safeReply(interaction, `Команды бота работают в ${allowed.map((id) => `<#${id}>`).join(", ")}.`);
        return;
      }

      await command.execute(interaction);
      return;
    }

    if (interaction.isMessageComponent()) {
      const command = byPrefix.get(interaction.customId.split(":")[0] ?? "");
      // Сообщения магазина эфемерные, их видит только тот, кто вызвал команду,
      // но на всякий случай проверяем автора исходной команды.
      const owner = interaction.message.interactionMetadata?.user.id;
      if (owner && owner !== interaction.user.id) {
        await safeReply(interaction, "Это меню открыл другой игрок.");
        return;
      }
      await command?.handleComponent?.(interaction);
      return;
    }

    if (interaction.isModalSubmit()) {
      const command = byPrefix.get(interaction.customId.split(":")[0] ?? "");
      await command?.handleModal?.(interaction);
    }
  } catch (err) {
    log.error("Ошибка обработки взаимодействия", err);
    await safeReply(interaction, "Что-то пошло не так. Попробуй ещё раз.");
  }
}
