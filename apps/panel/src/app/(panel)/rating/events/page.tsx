import { EventsView } from "@/components/EventsView";
import { requirePage } from "@/lib/auth";

export const metadata = { title: "История" };

export default async function EventsPage({ searchParams }: { searchParams: Promise<{ level?: string; group?: string; q?: string; page?: string }> }) {
  await requirePage();
  return (
    <EventsView
      botKey="rating"
      basePath="/rating/events"
      withMembers
      hint="Всё, что делал бот: покупки, ранги, репутация, заявки, окончание сроков, предупреждения и ошибки. Действия админов в панели — в «Журнале действий»."
      params={await searchParams}
    />
  );
}
