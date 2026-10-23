import type { ConnectableBot } from "@flamebot/core";

// Что показывать в разделе «Подключение» каждого бота.
export interface BotConnectionMeta {
  title: string;
  // Права для ссылки-приглашения (битовая маска Discord).
  permissions: string;
  permissionsText: string;
  // Что включить в Developer Portal → Bot.
  intents: string | null;
  // Подсказка, с каким модулем можно делить один токен.
  sharedHint?: string;
}

export const BOT_CONNECTIONS: Record<ConnectableBot, BotConnectionMeta> = {
  link: {
    title: "Бот привязки Steam",
    permissions: "268520448",
    permissionsText: "просмотр каналов, отправка сообщений, встраивание ссылок, чтение истории сообщений, управление ролями",
    intents: null,
    sharedHint: "Можно вставить тот же токен, что у бота рейтинга: в Discord это будет один бот.",
  },
  rating: {
    title: "Бот рейтинга",
    permissions: "268487680",
    permissionsText: "просмотр каналов, отправка сообщений, встраивание ссылок, прикрепление файлов, управление ролями",
    intents: "Message Content Intent: без него бот не видит длину сообщений и не начисляет опыт",
    sharedHint: "Этот же токен можно вставить в «Привязку Steam»: в Discord это будет один бот.",
  },
  giveaway: {
    title: "Бот розыгрышей",
    permissions: "84992",
    permissionsText: "просмотр каналов, отправка сообщений, встраивание ссылок, чтение истории сообщений",
    intents: null,
  },
};

// Один бот Discord может работать у нескольких модулей (один токен): права приглашения складываются.
export function combinedPermissions(bots: ConnectableBot[]): string {
  return bots.reduce((sum, b) => sum | BigInt(BOT_CONNECTIONS[b].permissions), 0n).toString();
}

export function inviteUrl(applicationId: string, permissions: string): string {
  const q = new URLSearchParams({ client_id: applicationId, scope: "bot applications.commands", permissions });
  return `https://discord.com/oauth2/authorize?${q.toString()}`;
}
