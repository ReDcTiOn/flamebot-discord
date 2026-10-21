import { EventsView } from "@/components/EventsView";
import { requirePage } from "@/lib/auth";

export const metadata = { title: "История карт" };

export default async function MapsEventsPage({ searchParams }: { searchParams: Promise<{ level?: string; group?: string; page?: string }> }) {
  await requirePage();
  return (
    <EventsView
      botKey="maps"
      basePath="/maps/events"
      withMembers={false}
      hint="Начало генераций, подтверждённые и свои карты, анонсы, запись ссылок в Pterodactyl, действия из панели и сбои. Изменения настроек — в «Журнале действий»."
      params={await searchParams}
    />
  );
}
