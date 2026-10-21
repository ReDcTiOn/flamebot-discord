import { EventsView } from "@/components/EventsView";
import { requirePage } from "@/lib/auth";

export const metadata = { title: "История объявлений" };

export default async function NoticeEventsPage({ searchParams }: { searchParams: Promise<{ level?: string; group?: string; page?: string }> }) {
  await requirePage();
  return (
    <EventsView
      botKey="notices"
      basePath="/notices/events"
      withMembers={false}
      hint="Уведомления и подтверждения, опубликованные объявления, промокоды, план дня, действия из панели и сбои. Изменения настроек — в «Журнале действий»."
      params={await searchParams}
    />
  );
}
