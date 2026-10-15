import { Suspense } from "react";
import { PageHeader, PageSkeleton } from "@/components/ui";
import { TalkClient } from "./talk-client";

export const metadata = { title: "Talk to agent" };

export default function TalkPage(props: PageProps<"/h/[hotelId]/talk">) {
  return (
    <>
      <PageHeader title="Talk to agent" subtitle="Test the voice agent from your browser: speak into the mic, no phone line needed" />
      <Suspense fallback={<PageSkeleton rows={6} />}>
        <TalkContent {...props} />
      </Suspense>
    </>
  );
}

async function TalkContent({ params }: PageProps<"/h/[hotelId]/talk">) {
  const { hotelId } = await params;
  return <TalkClient hotelId={hotelId} />;
}
