import { EventsView } from "@/components/EventsView";
import { requirePage } from "@/lib/auth";

export const metadata = { title: "История привязок" };

export default async function LinkEventsPage({ searchParams }: { searchParams: Promise<{ level?: string; group?: string; q?: string; page?: string }> }) {
  await requirePage();
  return (
    <EventsView
      botKey="link"
      basePath="/link/events"
      withMembers
      hint="Новые привязки, выдача и снятие роли, сообщение с кнопкой и сбои бота. Отвязки и правки настроек в панели — в «Журнале действий»."
      params={await searchParams}
    />
  );
}
