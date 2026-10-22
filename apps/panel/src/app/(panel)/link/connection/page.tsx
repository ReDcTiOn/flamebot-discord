import { BotConnection } from "@/components/BotConnection";

export const metadata = { title: "Подключение бота привязки" };

export default function LinkConnectionPage() {
  return <BotConnection botKey="link" />;
}
