import { EventsView } from "@/components/EventsView";
import { requirePage } from "@/lib/auth";

export const metadata = { title: "История онлайна" };

export default async function OnlineEventsPage({ searchParams }: { searchParams: Promise<{ level?: string; group?: string; page?: string }> }) {
  await requirePage();
  return (
    <EventsView
      botKey="online"
      basePath="/online/events"
      withMembers={false}
      hint="Когда серверы выключались и снова поднимались, ошибки входа ботов в Discord и другие сбои. Действия админов — в «Журнале действий»."
      params={await searchParams}
    />
  );
}
