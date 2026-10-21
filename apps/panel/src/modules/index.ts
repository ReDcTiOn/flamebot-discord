// Реестр ботов, подключённых к панели. Чтобы добавить нового бота:
//   1. добавь его таблицы в packages/core/prisma/schema.prisma (свой раздел);
//   2. создай страницы в src/app/(panel)/<key>/;
//   3. допиши модуль сюда. Бот должен отмечаться в BotStatus под тем же key.
// Каждый модуль появляется отдельной иконкой в левой колонке панели.

export interface ModuleNavItem {
  href: string;
  label: string;
  icon: IconName;
}

export interface ModuleNavSection {
  title: string | null;
  items: ModuleNavItem[];
}

export interface PanelModule {
  key: string;
  title: string;
  description: string;
  icon: IconName;
  // Цвет круглой иконки модуля в левой колонке.
  color: string;
  sections: ModuleNavSection[];
}

export type IconName =
  | "dashboard"
  | "trending"
  | "thumb"
  | "store"
  | "users"
  | "hash"
  | "message"
  | "coin"
  | "shield"
  | "list"
  | "home"
  | "clock"
  | "ruler"
  | "repeat"
  | "palette"
  | "megaphone"
  | "mic"
  | "layers"
  | "package"
  | "search"
  | "image"
  | "server"
  | "activity"
  | "gift"
  | "ticket";

export const modules: PanelModule[] = [
  {
    key: "rating",
    title: "Рейтинг участников",
    description: "Опыт за общение, ранги, репутация и магазин за скрап",
    icon: "coin",
    color: "#c9822a",
    sections: [
      { title: null, items: [{ href: "/rating", label: "Обзор", icon: "dashboard" }] },
      {
        title: "Рейтинг",
        items: [
          { href: "/rating/xp", label: "Опыт и ранги", icon: "trending" },
          { href: "/rating/rep", label: "Репутация", icon: "thumb" },
          { href: "/rating/members", label: "Игроки", icon: "users" },
          { href: "/rating/card", label: "Карточка профиля", icon: "image" },
        ],
      },
      {
        title: "Экономика",
        items: [{ href: "/rating/shop", label: "Магазин", icon: "store" }],
      },
      {
        title: "Настройки",
        items: [
          { href: "/rating/channels", label: "Каналы", icon: "hash" },
          { href: "/rating/messages", label: "Сообщения", icon: "message" },
        ],
      },
      {
        title: "Журнал",
        items: [{ href: "/rating/events", label: "История", icon: "list" }],
      },
    ],
  },
  {
    key: "online",
    title: "Онлайн серверов",
    description: "Discord-боты, которые показывают онлайн игровых серверов RUST в своём статусе",
    icon: "server",
    color: "#3ba55d",
    sections: [
      { title: null, items: [{ href: "/online", label: "Обзор", icon: "activity" }] },
      {
        title: "Управление",
        items: [
          { href: "/online/servers", label: "Серверы", icon: "server" },
          { href: "/online/settings", label: "Настройки", icon: "layers" },
        ],
      },
      { title: "Журнал", items: [{ href: "/online/events", label: "История", icon: "list" }] },
    ],
  },
  {
    key: "giveaway",
    title: "Розыгрыши",
    description: "Розыгрыши с кнопкой «Участвовать», итоги по расписанию и промокоды победителям в ЛС",
    icon: "gift",
    color: "#ff5a1f",
    sections: [
      { title: null, items: [{ href: "/giveaway", label: "Обзор", icon: "dashboard" }] },
      {
        title: "Розыгрыши",
        items: [{ href: "/giveaway/list", label: "Все розыгрыши", icon: "gift" }],
      },
      { title: "Настройки", items: [{ href: "/giveaway/settings", label: "Настройки", icon: "layers" }] },
      { title: "Журнал", items: [{ href: "/giveaway/events", label: "История", icon: "list" }] },
    ],
  },
];

export function moduleForPath(pathname: string): PanelModule | null {
  return modules.find((m) => pathname === `/${m.key}` || pathname.startsWith(`/${m.key}/`)) ?? null;
}
