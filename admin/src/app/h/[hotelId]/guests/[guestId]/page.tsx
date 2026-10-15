import Link from "next/link";
import { Suspense } from "react";
import { api } from "@/lib/api";
import { getHotel } from "@/lib/auth";
import { dateTime, duration, money } from "@/lib/format";
import type { Booking, CallLog, Guest } from "@/lib/types";
import { BookingTable } from "@/components/booking-table";
import { Badge, Card, PageHeader, PageSkeleton, Stat, Table } from "@/components/ui";
import { GuestEditor } from "./guest-editor";

export const metadata = { title: "Guest" };

export default function GuestPage(props: PageProps<"/h/[hotelId]/guests/[guestId]">) {
  return (
    <Suspense fallback={<PageSkeleton tiles={4} />}>
      <GuestContent {...props} />
    </Suspense>
  );
}

async function GuestContent({ params }: PageProps<"/h/[hotelId]/guests/[guestId]">) {
  const { hotelId, guestId } = await params;
  const [hotel, { guest, bookings, calls }] = await Promise.all([
    getHotel(hotelId),
    api<{ guest: Guest; bookings: Booking[]; calls: CallLog[] }>(`/hotels/${hotelId}/guests/${guestId}`),
  ]);
  const stays = bookings.filter((b) => ["checked_out", "checked_in"].includes(b.status));
  const spent = bookings.reduce((s, b) => s + b.amountPaid - b.amountRefunded, 0);
  const nights = stays.reduce((s, b) => s + b.nights, 0);
  return (
    <>
      <PageHeader title={guest.name} subtitle={<>{guest.phone}{guest.email && ` · ${guest.email}`} {guest.vip && <Badge value="VIP" tone="info" />}</>}
        actions={<Link href={`/h/${hotelId}/guests`} className="text-sm text-accent">← All guests</Link>} />
      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Bookings" value={bookings.length} />
        <Stat label="Completed stays" value={stays.length} hint={`${nights} nights`} />
        <Stat label="Lifetime spend" value={money(spent, hotel.currency)} />
        <Stat label="Calls" value={calls.length} />
      </div>
      <div className="grid gap-4 xl:grid-cols-[1fr_340px]">
        <div className="space-y-4">
          <Card title="Booking history" pad={false}><BookingTable hotelId={hotelId} items={bookings} /></Card>
          <Card title="Call history" pad={false}>
            <Table head={<tr><th>When</th><th>Outcome</th><th>Duration</th><th>Summary</th></tr>} empty="No calls">
              {calls.map((c) => (
                <tr key={c._id}>
                  <td className="whitespace-nowrap"><Link href={`/h/${hotelId}/calls/${c._id}`} className="text-accent hover:underline">{dateTime(c.startedAt ?? c.createdAt, hotel.timezone)}</Link></td>
                  <td><Badge value={c.outcome} /></td>
                  <td className="tabular">{duration(c.durationSec)}</td>
                  <td className="text-ink-2">{c.summary}</td>
                </tr>
              ))}
            </Table>
          </Card>
        </div>
        <GuestEditor hotelId={hotelId} guestId={guest._id} vip={guest.vip} notes={guest.notes ?? ""} />
      </div>
    </>
  );
}
