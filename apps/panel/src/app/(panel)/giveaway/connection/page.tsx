import { BotConnection } from "@/components/BotConnection";

export const metadata = { title: "Подключение бота розыгрышей" };

export default function GiveawayConnectionPage() {
  return <BotConnection botKey="giveaway" />;
}
