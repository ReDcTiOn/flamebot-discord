import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ContainerBuilder,
  MessageFlags,
  SeparatorBuilder,
  SeparatorSpacingSize,
  TextDisplayBuilder,
  type MessageActionRowComponentBuilder,
} from "discord.js";

// Оформление сообщений бота на Components V2: блок с цветной полосой слева,
// текст с заголовками, разделители, кнопки прямо внутри блока.

export const UI = {
  brand: 0xc9822a,
  gold: 0xf1c40f,
  success: 0x3ba55d,
  danger: 0xed4245,
  info: 0x5865f2,
} as const;

export const SCRAP = "⚙️";

export const V2 = MessageFlags.IsComponentsV2;
export const V2_EPHEMERAL = MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral;

export const text = (content: string) => new TextDisplayBuilder().setContent(content.slice(0, 4000));

export const divider = (large = false, visible = true) =>
  new SeparatorBuilder().setDivider(visible).setSpacing(large ? SeparatorSpacingSize.Large : SeparatorSpacingSize.Small);

export function buttonRow(...buttons: ButtonBuilder[]) {
  return new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(...buttons);
}

export function button(id: string, label: string, style: ButtonStyle = ButtonStyle.Secondary, emoji?: string) {
  const b = new ButtonBuilder().setCustomId(id).setLabel(label.slice(0, 80)).setStyle(style);
  if (emoji) b.setEmoji(emoji);
  return b;
}

// Короткое сообщение-итог: заголовок, текст и, по желанию, кнопки.
export function notice(color: number, title: string, body: string, ...buttons: ButtonBuilder[]) {
  const c = new ContainerBuilder().setAccentColor(color).addTextDisplayComponents(text(`### ${title}\n${body}`));
  if (buttons.length > 0) c.addActionRowComponents(buttonRow(...buttons));
  return c;
}

export function avatarUrl(userId: string, hash: string | null, size = 128): string {
  if (!hash) return `https://cdn.discordapp.com/embed/avatars/${Number(BigInt(userId) >> 22n) % 6}.png`;
  return `https://cdn.discordapp.com/avatars/${userId}/${hash}.png?size=${size}`;
}
