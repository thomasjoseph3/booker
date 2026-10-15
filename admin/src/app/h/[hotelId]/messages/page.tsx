import Link from "next/link";
import { Suspense } from "react";
import { api } from "@/lib/api";
import { getHotel } from "@/lib/auth";
import { dateTime, label } from "@/lib/format";
import type { Notification, Page } from "@/lib/types";
import { Badge, Card, PageHeader, PageSkeleton, Pagination, WhatsAppText } from "@/components/ui";

export const metadata = { title: "WhatsApp log" };

export default function MessagesPage(props: PageProps<"/h/[hotelId]/messages">) {
  return (
    <>
      <PageHeader title="WhatsApp log" subtitle="Every payment link, confirmation and cancellation sent to guests" />
      <Suspense fallback={<PageSkeleton rows={8} />}>
        <MessagesContent {...props} />
      </Suspense>
    </>
  );
}

async function MessagesContent({ params, searchParams }: PageProps<"/h/[hotelId]/messages">) {
  const [{ hotelId }, sp] = await Promise.all([params, searchParams]);
  const page = Number(sp.page) || 1;
  const [hotel, data] = await Promise.all([getHotel(hotelId), api<Page<Notification>>(`/hotels/${hotelId}/notifications`, { query: { page, limit: 20 } })]);
  return (
    <Card pad={false}>
      <ul className="divide-y divide-line">
        {data.items.map((n) => {
          const booking = n.booking && typeof n.booking !== "string" ? n.booking : null;
          return (
            <li key={n._id} className="grid gap-2 px-4 py-3 md:grid-cols-[220px_1fr]">
              <div className="text-xs">
                <div className="font-medium capitalize text-ink">{label(n.template)}</div>
                <div className="text-muted">{dateTime(n.createdAt, hotel.timezone)}</div>
                <div className="text-muted">to {n.to}</div>
                {booking && <Link href={`/h/${hotelId}/bookings/${booking.code}`} className="font-mono text-accent">{booking.code}</Link>}
                <div className="mt-1"><Badge value={n.status} /></div>
              </div>
              <div className="max-w-2xl rounded-xl rounded-tl-sm bg-panel-2 p-3"><WhatsAppText text={n.message} /></div>
            </li>
          );
        })}
      </ul>
      <Pagination page={data.page} pages={data.pages} total={data.total} href={(p) => `/h/${hotelId}/messages?page=${p}`} />
    </Card>
  );
}
