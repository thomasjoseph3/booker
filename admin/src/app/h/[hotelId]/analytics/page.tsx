import Link from "next/link";
import { Suspense } from "react";
import clsx from "clsx";
import { api } from "@/lib/api";
import { axisDay, compactMoney, duration, label, money, shortDay, sourceLabel } from "@/lib/format";
import { BarChart, HBars, SplitBar } from "@/components/charts";
import { Card, PageHeader, PageSkeleton, Stat, Table } from "@/components/ui";

export const metadata = { title: "Analytics" };

type Analytics = {
  days: number; currency: string;
  calls: {
    total: number; byOutcome: Record<string, number>; bySentiment: Record<string, number>; avgDurationSec: number; totalTalkMinutes: number;
    bookingConversion: number; byDay: { date: string; calls: number; booked: number }[]; byHour: { hour: number; calls: number }[];
    topIntents: { intent: string; count: number }[];
  };
  agentBookings: { created: number; advanceRequested: number; paidWithinHold: number; expiredUnpaid: number; paymentConversion: number; bookingValue: number; byStatus: Record<string, number> };
  bookings: {
    bySource: { source: string; bookings: number; cancelled: number; revenue: number; roomNights: number }[];
    byRoomType: { roomType: string; bookings: number; revenue: number; roomNights: number }[];
    averageDailyRate: number; repeatGuestPercent: number;
  };
  occupancy: { averagePercent: number; byDay: { date: string; percent: number }[] };
};

const RANGES = [7, 30, 90];

export default function AnalyticsPage(props: PageProps<"/h/[hotelId]/analytics">) {
  return (
    <Suspense fallback={<PageSkeleton tiles={8} rows={10} />}>
      <AnalyticsContent {...props} />
    </Suspense>
  );
}

async function AnalyticsContent({ params, searchParams }: PageProps<"/h/[hotelId]/analytics">) {
  const [{ hotelId }, sp] = await Promise.all([params, searchParams]);
  const days = RANGES.includes(Number(sp.days)) ? Number(sp.days) : 30;
  const a = await api<Analytics>(`/hotels/${hotelId}/analytics`, { query: { days } });
  const c = a.currency;
  const fillDays = (rows: { date: string; calls: number; booked: number }[]) => {
    const m = new Map(rows.map((r) => [r.date, r]));
    return a.occupancy.byDay.map((o) => m.get(o.date) ?? { date: o.date, calls: 0, booked: 0 });
  };
  const callDays = fillDays(a.calls.byDay);
  const every = Math.ceil(callDays.length / 15);

  return (
    <>
      <PageHeader
        title="Analytics"
        subtitle="How the phone agent and the property are performing"
        actions={
          <div className="inline-flex rounded-lg border border-line bg-panel p-0.5">
            {RANGES.map((r) => (
              <Link key={r} href={`/h/${hotelId}/analytics?days=${r}`} className={clsx("rounded-md px-3 py-1 text-sm", r === days ? "bg-accent text-accent-ink" : "text-ink-2 hover:bg-panel-2")}>
                {r} days
              </Link>
            ))}
          </div>
        }
      />

      <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">Phone agent</h2>
      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-6">
        <Stat label="Calls handled" value={a.calls.total} hint={`${a.calls.totalTalkMinutes} talk minutes`} />
        <Stat label="Call → booking" value={`${a.calls.bookingConversion}%`} hint={`${a.calls.byOutcome.booked ?? 0} calls booked`} />
        <Stat label="Paid within hold" value={`${a.agentBookings.paymentConversion}%`} hint={`${a.agentBookings.paidWithinHold} of ${a.agentBookings.advanceRequested} advance links`} />
        <Stat label="Holds expired" value={a.agentBookings.expiredUnpaid} hint="rooms released unpaid" />
        <Stat label="Agent booking value" value={compactMoney(a.agentBookings.bookingValue, c)} hint={`${a.agentBookings.created} bookings`} />
        <Stat label="Avg call length" value={duration(a.calls.avgDurationSec)} />
      </div>

      <div className="mb-4 grid gap-4 xl:grid-cols-3">
        <Card title="Calls per day" className="xl:col-span-2">
          <BarChart
            height={180}
            series={[{ key: "booked", label: "Resulted in booking", color: "var(--series-1)" }, { key: "other", label: "Other outcome", color: "var(--series-2)" }]}
            labelEvery={every}
            data={callDays.map((d) => ({ label: axisDay(d.date), values: { booked: d.booked, other: d.calls - d.booked }, tooltip: `${shortDay(d.date)} · ${d.calls} calls` }))}
          />
        </Card>
        <Card title="Call outcomes">
          <HBars rows={Object.entries(a.calls.byOutcome).sort((x, y) => y[1] - x[1]).map(([k, v]) => ({ label: label(k), value: v }))} />
        </Card>
      </div>

      <div className="mb-6 grid items-start gap-4 xl:grid-cols-3">
        <Card title="When guests call (hour of day)" className="xl:col-span-2">
          <BarChart
            height={150}
            series={[{ key: "calls", label: "Calls", color: "var(--series-1)" }]}
            labelEvery={3}
            data={a.calls.byHour.map((h) => ({ label: `${h.hour}h`, values: { calls: h.calls }, tooltip: `${String(h.hour).padStart(2, "0")}:00–${String(h.hour).padStart(2, "0")}:59` }))}
          />
        </Card>
        <div className="space-y-4">
          <Card title="Caller sentiment">
            <SplitBar parts={[
              { label: "positive", value: a.calls.bySentiment.positive ?? 0, color: "var(--series-3)" },
              { label: "neutral", value: a.calls.bySentiment.neutral ?? 0, color: "var(--series-1)" },
              { label: "negative", value: a.calls.bySentiment.negative ?? 0, color: "var(--series-2)" },
            ]} />
          </Card>
          <Card title="Top reasons for calling">
            <HBars rows={a.calls.topIntents.map((i) => ({ label: label(i.intent), value: i.count }))} />
          </Card>
        </div>
      </div>

      <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">Property</h2>
      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Average occupancy" value={`${a.occupancy.averagePercent}%`} hint={`last ${days} nights`} />
        <Stat label="Average daily rate" value={money(a.bookings.averageDailyRate, c)} hint="per room night incl. tax" />
        <Stat label="Repeat guests" value={`${a.bookings.repeatGuestPercent}%`} hint="guests with 2+ bookings" />
        <Stat label="Bookings made" value={a.bookings.bySource.reduce((s, x) => s + x.bookings, 0)} hint={`last ${days} days`} />
      </div>

      <Card title="Occupancy by night" className="mb-4">
        <BarChart
          height={150}
          max={100}
          suffix="%"
          labelEvery={every}
          series={[{ key: "percent", label: "Occupancy", color: "var(--series-1)" }]}
          data={a.occupancy.byDay.map((o) => ({ label: axisDay(o.date), values: { percent: o.percent }, tooltip: shortDay(o.date) }))}
        />
      </Card>

      <div className="grid gap-4 xl:grid-cols-2">
        <Card title="Bookings by channel" pad={false}>
          <Table head={<tr><th>Channel</th><th className="text-right">Bookings</th><th className="text-right">Cancelled</th><th className="text-right">Room nights</th><th className="text-right">Revenue</th></tr>}>
            {a.bookings.bySource.map((s) => (
              <tr key={s.source}>
                <td>{sourceLabel(s.source)}</td>
                <td className="tabular text-right">{s.bookings}</td>
                <td className="tabular text-right">{s.cancelled}</td>
                <td className="tabular text-right">{s.roomNights}</td>
                <td className="tabular text-right">{money(s.revenue, c)}</td>
              </tr>
            ))}
          </Table>
        </Card>
        <Card title="Revenue by room type" pad={false}>
          <Table head={<tr><th>Room type</th><th className="text-right">Bookings</th><th className="text-right">Room nights</th><th className="text-right">Revenue</th></tr>}>
            {a.bookings.byRoomType.map((r) => (
              <tr key={r.roomType}>
                <td>{r.roomType}</td>
                <td className="tabular text-right">{r.bookings}</td>
                <td className="tabular text-right">{r.roomNights}</td>
                <td className="tabular text-right">{money(r.revenue, c)}</td>
              </tr>
            ))}
          </Table>
        </Card>
      </div>
    </>
  );
}
