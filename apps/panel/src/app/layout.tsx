import type { Metadata } from "next";
import { headers } from "next/headers";
import type { ReactNode } from "react";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "FlameBot", template: "%s · FlameBot" },
  description: "Панель управления ботами сервера",
  robots: { index: false, follow: false },
};

export default async function RootLayout({ children }: { children: ReactNode }) {
  // Чтение заголовков делает все страницы динамическими: nonce из CSP нужен на каждом ответе.
  await headers();
  return (
    <html lang="ru">
      <body>{children}</body>
    </html>
  );
}
