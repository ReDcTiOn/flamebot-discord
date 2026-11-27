import { giveawayMessageConfig, renderTemplate, type GiveawayMessageKey, type GiveawayMessageSettings } from "@flamebot/core";

export function giveawayPayload(
  settings: GiveawayMessageSettings,
  key: GiveawayMessageKey,
  text: string,
  vars: Record<string, string | number> = {},
  { canEmbed = true, mentionText }: { canEmbed?: boolean; mentionText?: string } = {},
) {
  const config = giveawayMessageConfig(settings, key);
  if (config.format !== "embed" || !canEmbed) return { content: text.slice(0, 2000) };
  const title = renderTemplate(config.title, vars).trim().slice(0, 256);
  const footer = renderTemplate(config.footer, vars).trim().slice(0, 256);
  return {
    ...(mentionText ? { content: mentionText } : {}),
    embeds: [{
      ...(title ? { title } : {}),
      description: text.slice(0, 4096),
      color: Number.parseInt(config.color.slice(1), 16),
      ...(footer ? { footer: { text: footer } } : {}),
    }],
  };
}
