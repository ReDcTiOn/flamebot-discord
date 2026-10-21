import { EventsView } from "@/components/EventsView";
import { requirePage } from "@/lib/auth";

export const metadata = { title: "История розыгрышей" };

export default async function GiveawayEventsPage({ searchParams }: { searchParams: Promise<{ level?: string; group?: string; q?: string; page?: string }> }) {
  await requirePage();
  return (
    <EventsView
      botKey="giveaway"
      basePath="/giveaway/events"
      withMembers
      hint="Созданные и завершённые розыгрыши, рероллы, доставка промокодов и сбои бота. Действия админов в панели — в «Журнале действий»."
      params={await searchParams}
    />
  );
}
