import { BotConnection } from "@/components/BotConnection";

export const metadata = { title: "Подключение бота рейтинга" };

export default function RatingConnectionPage() {
  return <BotConnection botKey="rating" />;
}
