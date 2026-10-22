import type { ConnectableBot } from "@flamebot/core";

// Что показывать в разделе «Подключение» каждого бота.
export interface BotConnectionMeta {
  title: string;
  // Права для ссылки-приглашения (битовая маска Discord).
  permissions: string;
  permissionsText: string;
  // Что включить в Developer Portal → Bot.
  intents: string | null;
}

export const BOT_CONNECTIONS: Record<ConnectableBot, BotConnectionMeta> = {
  link: {
    title: "Бот привязки Steam",
    permissions: "268520448",
    permissionsText: "просмотр каналов, отправка сообщений, встраивание ссылок, чтение истории сообщений, управление ролями",
    intents: null,
  },
  rating: {
    title: "Бот рейтинга",
    permissions: "268487680",
    permissionsText: "просмотр каналов, отправка сообщений, встраивание ссылок, прикрепление файлов, управление ролями",
    intents: "Message Content Intent: без него бот не видит длину сообщений и не начисляет опыт",
  },
  giveaway: {
    title: "Бот розыгрышей",
    permissions: "84992",
    permissionsText: "просмотр каналов, отправка сообщений, встраивание ссылок, чтение истории сообщений",
    intents: null,
  },
};

export function inviteUrl(applicationId: string, permissions: string): string {
  const q = new URLSearchParams({ client_id: applicationId, scope: "bot applications.commands", permissions });
  return `https://discord.com/oauth2/authorize?${q.toString()}`;
}
