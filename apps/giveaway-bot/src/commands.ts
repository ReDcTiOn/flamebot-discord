import {
  ChannelType,
  InteractionContextType,
  PermissionFlagsBits,
  SlashCommandBuilder,
  type SlashCommandIntegerOption,
  type RESTPostAPIChatInputApplicationCommandsJSONBody,
} from "discord.js";
import { GIVEAWAY_MAX_WINNERS, type GiveawaySettings } from "@flamebot/core";

export const COMMAND_NAME = "розыгрыш";

// Подсказки команды зависят от настроек (часовой пояс, «быстрый» розыгрыш),
// поэтому описание собирается из них и перерегистрируется, когда настройки меняются.
export function buildCommands(s: GiveawaySettings): RESTPostAPIChatInputApplicationCommandsJSONBody[] {
  const giveawayOption = (description: string) => (o: SlashCommandIntegerOption) =>
    o.setName("розыгрыш").setDescription(description).setRequired(true).setAutocomplete(true);

  const command = new SlashCommandBuilder()
    .setName(COMMAND_NAME)
    .setDescription("Управление розыгрышами")
    .setContexts(InteractionContextType.Guild)
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommand((c) =>
      c
        .setName("создать")
        .setDescription("Создать новый розыгрыш")
        .addStringOption((o) => o.setName("приз").setDescription("Что разыгрывается").setRequired(true).setMinLength(1).setMaxLength(200))
        .addIntegerOption((o) =>
          o
            .setName("количество")
            .setDescription("Сколько будет победителей (каждый получает приз)")
            .setRequired(true)
            .setMinValue(1)
            .setMaxValue(GIVEAWAY_MAX_WINNERS),
        )
        .addStringOption((o) => o.setName("дата").setDescription("Дата подведения итогов, например 30.09.2026").setRequired(true).setAutocomplete(true))
        .addStringOption((o) =>
          o
            .setName("время")
            .setDescription(`Время подведения итогов (${s.timezoneLabel}), например 20:00`.slice(0, 100))
            .setRequired(true)
            .setAutocomplete(true),
        )
        .addBooleanOption((o) => o.setName("только_бустеры").setDescription("Участвовать могут только бустеры сервера"))
        .addBooleanOption((o) => o.setName("промокоды").setDescription("Выдать победителям промокоды в ЛС (откроется окно для ввода промокодов)"))
        .addChannelOption((o) =>
          o
            .setName("канал")
            .setDescription("Канал, куда отправить розыгрыш (по умолчанию - текущий)")
            .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement),
        )
        .addStringOption((o) => o.setName("описание").setDescription("Доп. описание или условия розыгрыша").setMaxLength(1000)),
    )
    .addSubcommand((c) =>
      c
        .setName("быстрый")
        .setDescription(`${s.quickPrize} · ${s.quickWinners} поб. · в ${s.quickTime} - останется ввести промокоды`.slice(0, 100)),
    )
    .addSubcommand((c) => c.setName("завершить").setDescription("Подвести итоги досрочно").addIntegerOption(giveawayOption("Какой розыгрыш завершить")))
    .addSubcommand((c) =>
      c
        .setName("реролл")
        .setDescription("Перевыбрать победителей завершённого розыгрыша")
        .addIntegerOption(giveawayOption("Какой розыгрыш"))
        .addIntegerOption((o) =>
          o.setName("количество").setDescription("Сколько новых победителей выбрать (по умолчанию 1)").setMinValue(1).setMaxValue(GIVEAWAY_MAX_WINNERS),
        ),
    )
    .addSubcommand((c) =>
      c
        .setName("промокоды")
        .setDescription("Кому какой промокод достался, повторная отправка")
        .addIntegerOption(giveawayOption("Завершённый розыгрыш с промокодами")),
    )
    .addSubcommand((c) =>
      c.setName("отменить").setDescription("Отменить розыгрыш без подведения итогов").addIntegerOption(giveawayOption("Какой розыгрыш отменить")),
    )
    .addSubcommand((c) => c.setName("список").setDescription("Показать активные розыгрыши"));

  return [command.toJSON()];
}
