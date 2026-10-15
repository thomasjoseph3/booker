import Link from "next/link";
import { Suspense } from "react";
import { api } from "@/lib/api";
import { getHotel } from "@/lib/auth";
import { compactMoney, dateTime, duration, money, shortDay, time, weekday } from "@/lib/format";
import type { Booking, CallLog, Page } from "@/lib/types";
import { BarChart } from "@/components/charts";
import { BookingTable } from "@/components/booking-table";
import { Badge, Card, PageHeader, PageSkeleton, Stat, Table } from "@/components/ui";

export const metadata = { title: "Dashboard" };

type Dashboard = {
  today: string; currency: string; totalRooms: number;
  occupancyTonight: { booked: number; totalRooms: number; percent: number };
  occupancy: { date: string; booked: number; totalRooms: number; percent: number }[];
  arrivals: Booking[]; departures: Booking[];
  counts: { inHouse: number; pendingPayment: number; callsToday: number; bookingsToday: number };
  revenue30d: { collected: number; refunded: number; net: number };
  roomStatus: { available: number; occupied: number; cleaning: number; out_of_service: number };
};

export default function DashboardPage({ params }: PageProps<"/h/[hotelId]">) {
  return (
    <Suspense fallback={<PageSkeleton tiles={8} />}>
      <DashboardContent params={params} />
    </Suspense>
  );
}

async function DashboardContent({ params }: { params: PageProps<"/h/[hotelId]">["params"] }) {
  const { hotelId } = await params;
  const [hotel, d, holds, calls] = await Promise.all([
    getHotel(hotelId),
    api<Dashboard>(`/hotels/${hotelId}/dashboard`),
    api<Page<Booking>>(`/hotels/${hotelId}/bookings`, { query: { status: "pending_payment", limit: 10 } }),
    api<Page<CallLog>>(`/hotels/${hotelId}/calls`, { query: { limit: 6 } }),
  ]);
  const base = `/h/${hotelId}`;
  const c = d.currency;
  const pendingArrivals = d.arrivals.filter((b) => b.status !== "checked_in").length;
  const pendingDepartures = d.departures.filter((b) => b.status === "checked_in").length;

  return (
    <>
      <PageHeader title={hotel.name} subtitle={`Today · ${new Date(`${d.today}T00:00:00Z`).toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" })}`} />

      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-7">
        <Stat label="Occupancy tonight" value={`${d.occupancyTonight.percent}%`} hint={`${d.occupancyTonight.booked} of ${d.totalRooms} rooms`} href={`${base}/inventory`} />
        <Stat label="In house" value={d.counts.inHouse} hint="bookings checked in" href={`${base}/bookings?view=in_house`} />
        <Stat label="Arrivals today" value={d.arrivals.length} hint={`${pendingArrivals} still to check in`} href={`${base}/bookings?view=arrivals`} />
        <Stat label="Departures today" value={d.departures.length} hint={`${pendingDepartures} still to check out`} href={`${base}/bookings?view=departures`} />
        <Stat label="Rooms on hold" value={d.counts.pendingPayment} hint="awaiting advance" href={`${base}/bookings?status=pending_payment`} />
        <Stat label="Agent calls" value={d.counts.callsToday} hint="last 24 hours" href={`${base}/calls`} />
        <Stat label="Net collected" value={compactMoney(d.revenue30d.net, c)} hint="last 30 days" href={`${base}/payments`} />
      </div>

      <Card title="Rooms right now" className="mb-4" actions={<Link href={`${base}/rooms`} className="text-xs text-accent">Housekeeping board →</Link>}>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          {([
            ["occupied", "Occupied", "bg-info", "guests in house"],
            ["cleaning", "Being cleaned", "bg-warn", "vacated, not ready yet"],
            ["available", "Ready", "bg-ok", "clean and free"],
            ["out_of_service", "Out of service", "bg-bad", "not for sale"],
          ] as const).map(([key, title, dot, hint]) => (
            <div key={key} className="flex items-center gap-3 rounded-lg bg-panel-2 p-3">
              <span className={`size-2.5 shrink-0 rounded-full ${dot}`} />
              <div>
                <div className="tabular text-xl font-semibold">{d.roomStatus[key]}<span className="text-sm font-normal text-muted"> / {d.totalRooms}</span></div>
                <div className="text-xs text-muted">{title} · {hint}</div>
              </div>
            </div>
          ))}
        </div>
        <p className="mt-3 text-xs text-muted">Rooms being cleaned are still sold for tonight — they&apos;ll be ready before new guests arrive. Free to sell tonight: <b className="text-ink">{d.totalRooms - d.occupancyTonight.booked}</b>.</p>
      </Card>

      <div className="mb-4 grid gap-4 xl:grid-cols-3">
        <Card title="Occupancy · next 14 nights" className="xl:col-span-2" actions={<Link href={`${base}/inventory`} className="text-xs text-accent">Availability →</Link>}>
          <BarChart
            height={170}
            max={100}
            suffix="%"
            series={[{ key: "percent", label: "Occupancy", color: "var(--series-1)" }]}
            data={d.occupancy.map((o) => ({ label: shortDay(o.date), sub: weekday(o.date), values: { percent: o.percent }, tooltip: `${weekday(o.date)} ${shortDay(o.date)} · ${o.booked}/${o.totalRooms} rooms` }))}
          />
        </Card>
        <Card title="Rooms on hold" actions={<span className="text-xs text-muted">auto-release after {hotel.payment.holdMinutes} min</span>} pad={false}>
          {holds.items.length === 0 ? <p className="p-4 text-muted">No rooms waiting for payment.</p> : (
            <ul className="divide-y divide-line">
              {holds.items.map((b) => (
                <li key={b._id} className="flex items-center justify-between gap-2 px-4 py-2.5">
                  <div>
                    <Link href={`${base}/bookings/${b.code}`} className="font-medium hover:underline">{b.guestName}</Link>
                    <div className="text-xs text-muted">{b.roomTypeName} · {shortDay(b.checkIn)} · advance {money(b.advanceDue, c)}</div>
                  </div>
                  <div className="text-right text-xs">
                    <div className="text-warn">expires {time(b.holdExpiresAt, hotel.timezone)}</div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <div className="mb-4 grid gap-4 2xl:grid-cols-2">
        <Card title={`Arrivals today (${d.arrivals.length})`} pad={false}>
          <BookingTable hotelId={hotelId} items={d.arrivals} compact empty="No arrivals today" />
        </Card>
        <Card title={`Departures today (${d.departures.length})`} pad={false}>
          <BookingTable hotelId={hotelId} items={d.departures} compact empty="No departures today" />
        </Card>
      </div>

      <Card title="Latest agent calls" pad={false} actions={<Link href={`${base}/calls`} className="text-xs text-accent">All calls →</Link>}>
        <Table head={<tr><th>When</th><th>Caller</th><th>Outcome</th><th>Duration</th><th>Summary</th></tr>} empty="No calls yet">
          {calls.items.map((call) => (
            <tr key={call._id} className="hover:bg-panel-2">
              <td className="whitespace-nowrap"><Link href={`${base}/calls/${call._id}`} className="text-accent hover:underline">{dateTime(call.startedAt ?? call.createdAt, hotel.timezone)}</Link></td>
              <td className="whitespace-nowrap">{call.fromNumber}</td>
              <td><Badge value={call.outcome} /></td>
              <td className="tabular">{duration(call.durationSec)}</td>
              <td className="max-w-md truncate text-ink-2" title={call.summary}>{call.summary}</td>
            </tr>
          ))}
        </Table>
      </Card>
    </>
  );
}
