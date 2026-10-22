import { env } from "./env";

// Адрес API бота привязки для конфига плагина. Caddy отдаёт его на домене панели (docs/DEPLOY.md).
export function linkApiUrl(): string {
  return `${env().PANEL_URL.replace(/\/+$/, "")}/link-api`;
}

export function when(d: Date): string {
  return d.toLocaleString("ru-RU", { dateStyle: "short", timeStyle: "short" });
}
