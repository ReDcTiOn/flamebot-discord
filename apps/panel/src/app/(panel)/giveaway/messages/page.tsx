import {
  GIVEAWAY_MESSAGES,
  GIVEAWAY_MESSAGE_HINTS,
  GIVEAWAY_MESSAGE_SECTIONS,
  GIVEAWAY_PLACEHOLDERS,
  getGiveawaySettings,
  giveawayMessageConfig,
  giveawayMessageDefaults,
  giveawayMessageLength,
  giveawayMessagePlaceholders,
  giveawayMessageRequired,
  giveawayMessageSection,
  giveawayMessageSupportsEmbed,
  prisma,
  type GiveawayMessageKey,
} from "@flamebot/core";
import { PageHead } from "@/components/Fields";
import { requirePage } from "@/lib/auth";
import { MessagesEditor, type MessageDef, type MessageValue } from "./MessagesEditor";

export const metadata = { title: "Сообщения розыгрышей" };

const value = (c: ReturnType<typeof giveawayMessageConfig>): MessageValue => ({
  text: c.text,
  enabled: c.enabled,
  format: c.format,
  title: c.title,
  color: c.color,
  footer: c.footer,
});

export default async function GiveawayMessagesPage() {
  await requirePage("full");
  const [settings, guild] = await Promise.all([getGiveawaySettings(prisma), prisma.guildInfo.findUnique({ where: { id: 1 } })]);
  const keys = Object.keys(GIVEAWAY_MESSAGES) as GiveawayMessageKey[];

  const defs: MessageDef[] = keys.map((key) => {
    const def = GIVEAWAY_MESSAGES[key];
    return {
      key,
      label: def.label,
      hint: GIVEAWAY_MESSAGE_HINTS[key] ?? null,
      section: giveawayMessageSection(key),
      optional: def.optional,
      canEmbed: giveawayMessageSupportsEmbed(key),
      button: key.endsWith("Button"),
      maxLength: giveawayMessageLength(key),
      placeholders: giveawayMessagePlaceholders(key).map((p) => ({ key: p, desc: GIVEAWAY_PLACEHOLDERS[p] ?? "" })),
      required: giveawayMessageRequired(key),
    };
  });
  const saved = Object.fromEntries(keys.map((k) => [k, value(giveawayMessageConfig(settings, k))]));
  const defaults = Object.fromEntries(keys.map((k) => [k, value(giveawayMessageDefaults(settings, k))]));

  // Пример для превью: розыгрыш с итогами через 2 дня в 18:00.
  const now = Date.now();
  const ends = Math.floor((now + 2 * 86_400_000) / 3_600_000) * 3600;
  const samples: Record<string, string> = {
    prize: "Набор строителя",
    winners: "<@1>, <@2>",
    time: `<t:${ends}:F>`,
    relative: `<t:${ends}:R>`,
    count: "3",
    code: "FLAME-7Q2X",
    server: guild?.name ?? "FLAME RUST",
    id: "42",
    url: "https://discord.com/channels/…/42",
    endsAt: new Date(ends * 1000).toLocaleString("ru-RU", { timeZone: settings.timezone, dateStyle: "short", timeStyle: "short" }),
    timezone: settings.timezoneLabel,
    channel: "#розыгрыши",
    permissions: "Прикреплять файлы",
    value: "31.02.2026",
  };

  return (
    <>
      <PageHead title="Сообщения" hint="Тексты карточки розыгрыша, ответов игрокам и уведомлений. Что в фигурных скобках, бот подставит сам." />
      <MessagesEditor
        defs={defs}
        sections={GIVEAWAY_MESSAGE_SECTIONS.map((s) => ({ key: s.key, title: s.title }))}
        saved={saved}
        defaults={defaults}
        samples={samples}
        ctx={{ timeZone: settings.timezone, now, users: { "1": "Kreed", "2": "Fox" } }}
      />
    </>
  );
}
