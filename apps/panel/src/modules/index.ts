// Реестр ботов, подключённых к панели. Чтобы добавить нового бота:
//   1. добавь его таблицы в packages/core/prisma/schema.prisma (свой раздел);
//   2. создай страницы в src/app/(panel)/<key>/;
//   3. допиши модуль сюда. Бот должен отмечаться в BotStatus под тем же key.

export interface ModuleNavItem {
  href: string;
  label: string;
  icon: IconName;
}

export interface PanelModule {
  key: string;
  title: string;
  description: string;
  icon: IconName;
  nav: ModuleNavItem[];
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
  | "home";

export const modules: PanelModule[] = [
  {
    key: "rating",
    title: "Scrap Rank",
    description: "Опыт за общение, ранги, репутация и магазин за скрап",
    icon: "coin",
    nav: [
      { href: "/rating", label: "Обзор", icon: "dashboard" },
      { href: "/rating/xp", label: "Опыт и ранги", icon: "trending" },
      { href: "/rating/rep", label: "Репутация", icon: "thumb" },
      { href: "/rating/shop", label: "Магазин", icon: "store" },
      { href: "/rating/members", label: "Пользователи", icon: "users" },
      { href: "/rating/channels", label: "Каналы", icon: "hash" },
      { href: "/rating/messages", label: "Сообщения", icon: "message" },
    ],
  },
];
