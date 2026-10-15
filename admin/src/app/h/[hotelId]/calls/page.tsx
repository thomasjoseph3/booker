import Link from "next/link";
import { Suspense } from "react";
import { api } from "@/lib/api";
import { getHotel } from "@/lib/auth";
import { dateTime, duration, label } from "@/lib/format";
import type { CallLog, Page } from "@/lib/types";
import { Badge, buttonClass, Card, inputClass, PageHeader, PageSkeleton, Pagination, Table } from "@/components/ui";

export const metadata = { title: "Agent calls" };
const OUTCOMES = ["booked", "inquiry", "cancelled", "modified", "callback_requested", "abandoned", "other"];

export default function CallsPage(props: PageProps<"/h/[hotelId]/calls">) {
  return (
    <>
      <PageHeader title="Agent calls" subtitle="Every call handled by the reservations agent, with outcome and transcript" />
      <Suspense fallback={<PageSkeleton rows={12} />}>
        <CallsContent {...props} />
      </Suspense>
    </>
  );
}

async function CallsContent({ params, searchParams }: PageProps<"/h/[hotelId]/calls">) {
  const [{ hotelId }, sp] = await Promise.all([params, searchParams]);
  const outcome = typeof sp.outcome === "string" ? sp.outcome : "";
  const page = Number(sp.page) || 1;
  const [hotel, data] = await Promise.all([getHotel(hotelId), api<Page<CallLog>>(`/hotels/${hotelId}/calls`, { query: { outcome, page, limit: 30 } })]);
  return (
    <Card pad={false}>
      <form className="flex flex-wrap gap-2 border-b border-line p-3">
        <select name="outcome" defaultValue={outcome} className={`${inputClass} w-56`}>
          <option value="">All outcomes</option>
          {OUTCOMES.map((o) => <option key={o} value={o}>{label(o)}</option>)}
        </select>
        <button className={buttonClass("primary")}>Filter</button>
      </form>
      <Table head={<tr><th>When</th><th>Caller</th><th>Intent</th><th>Outcome</th><th>Sentiment</th><th>Duration</th><th>Bookings</th><th>Summary</th></tr>} empty="No calls recorded">
        {data.items.map((c) => (
          <tr key={c._id} className="hover:bg-panel-2">
            <td className="whitespace-nowrap"><Link href={`/h/${hotelId}/calls/${c._id}`} className="text-accent hover:underline">{dateTime(c.startedAt ?? c.createdAt, hotel.timezone)}</Link></td>
            <td className="whitespace-nowrap">{c.fromNumber}</td>
            <td className="whitespace-nowrap capitalize text-ink-2">{label(c.intent)}</td>
            <td><Badge value={c.outcome} /></td>
            <td><Badge value={c.sentiment} /></td>
            <td className="tabular whitespace-nowrap">{duration(c.durationSec)}</td>
            <td className="whitespace-nowrap">{c.bookings.map((b) => <Link key={b._id} href={`/h/${hotelId}/bookings/${b.code}`} className="mr-1 font-mono text-xs text-accent hover:underline">{b.code}</Link>)}</td>
            <td className="min-w-72 max-w-lg text-ink-2">{c.summary}</td>
          </tr>
        ))}
      </Table>
      <Pagination page={data.page} pages={data.pages} total={data.total} href={(p) => `/h/${hotelId}/calls?${new URLSearchParams({ ...(outcome ? { outcome } : {}), page: String(p) })}`} />
    </Card>
  );
}
