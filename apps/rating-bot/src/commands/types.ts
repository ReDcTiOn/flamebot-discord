import type {
  ChatInputCommandInteraction,
  MessageComponentInteraction,
  ModalSubmitInteraction,
  RESTPostAPIChatInputApplicationCommandsJSONBody,
} from "discord.js";

export interface Command {
  data: RESTPostAPIChatInputApplicationCommandsJSONBody;
  execute(interaction: ChatInputCommandInteraction<"cached">): Promise<void>;
  // Префикс customId компонентов и модалок, которые обрабатывает эта команда.
  componentPrefix?: string;
  handleComponent?(interaction: MessageComponentInteraction<"cached">): Promise<void>;
  handleModal?(interaction: ModalSubmitInteraction<"cached">): Promise<void>;
}

export const COLORS = {
  brand: 0xba7517,
  success: 0x639922,
  info: 0x378add,
  danger: 0xe24b4a,
} as const;
