import type { Metadata } from "next";
import { Inter } from "next/font/google";
import { headers } from "next/headers";
import type { ReactNode } from "react";
import "./globals.css";

// Шрифт скачивается при сборке и раздаётся с нашего же домена, CSP не нарушается.
const inter = Inter({ subsets: ["latin", "cyrillic"], variable: "--font-inter", display: "swap" });

export const metadata: Metadata = {
  title: { default: "FlameBot", template: "%s · FlameBot" },
  description: "Панель управления ботами сервера",
  robots: { index: false, follow: false },
};

export default async function RootLayout({ children }: { children: ReactNode }) {
  // Чтение заголовков делает все страницы динамическими: nonce из CSP нужен на каждом ответе.
  await headers();
  return (
    <html lang="ru" className={inter.variable}>
      <body>{children}</body>
    </html>
  );
}
