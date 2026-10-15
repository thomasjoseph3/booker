import { Suspense } from "react";
import { api } from "@/lib/api";
import { getMe, isManager } from "@/lib/auth";
import type { AssistantChat } from "@/lib/types";
import { PageHeader, PageSkeleton } from "@/components/ui";
import { AssistantClient } from "./assistant-client";

export const metadata = { title: "Assistant" };

export default function AssistantPage(props: PageProps<"/h/[hotelId]/assistant">) {
  return (
    <>
      <PageHeader title="Assistant" subtitle="Ask about today, availability, bookings, payments, analytics and how the AI phone agent is doing" />
      <Suspense fallback={<PageSkeleton rows={8} />}>
        <AssistantContent {...props} />
      </Suspense>
    </>
  );
}

async function AssistantContent({ params }: PageProps<"/h/[hotelId]/assistant">) {
  const { hotelId } = await params;
  const [me, chats] = await Promise.all([getMe(), api<{ items: AssistantChat[] }>(`/hotels/${hotelId}/assistant/chats`)]);
  return <AssistantClient hotelId={hotelId} initialChats={chats.items} canSeeAll={isManager(me)} meId={me.id} />;
}
