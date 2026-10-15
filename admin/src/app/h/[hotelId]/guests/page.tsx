import Link from "next/link";
import { Suspense } from "react";
import { api } from "@/lib/api";
import { getHotel } from "@/lib/auth";
import { day, money } from "@/lib/format";
import type { Guest, Page } from "@/lib/types";
import { Badge, buttonClass, Card, inputClass, PageHeader, PageSkeleton, Pagination, Table } from "@/components/ui";

export const metadata = { title: "Guests" };

export default function GuestsPage(props: PageProps<"/h/[hotelId]/guests">) {
  return (
    <>
      <PageHeader title="Guests" subtitle="Everyone who has booked or called, with their history" />
      <Suspense fallback={<PageSkeleton rows={12} />}>
        <GuestsContent {...props} />
      </Suspense>
    </>
  );
}

async function GuestsContent({ params, searchParams }: PageProps<"/h/[hotelId]/guests">) {
  const [{ hotelId }, sp] = await Promise.all([params, searchParams]);
  const q = typeof sp.q === "string" ? sp.q : "";
  const page = Number(sp.page) || 1;
  const [hotel, data] = await Promise.all([getHotel(hotelId), api<Page<Guest>>(`/hotels/${hotelId}/guests`, { query: { q, page, limit: 30 } })]);
  return (
    <Card pad={false}>
      <form className="flex gap-2 border-b border-line p-3">
        <input name="q" defaultValue={q} placeholder="Search name, phone or email" className={`${inputClass} max-w-sm`} />
        <button className={buttonClass("primary")}>Search</button>
      </form>
      <Table head={<tr><th>Guest</th><th>Phone</th><th>Email</th><th className="text-right">Bookings</th><th className="text-right">Stays</th><th className="text-right">Lifetime spend</th><th>Last stay</th></tr>} empty="No guests found">
        {data.items.map((g) => (
          <tr key={g._id} className="hover:bg-panel-2">
            <td className="whitespace-nowrap"><Link href={`/h/${hotelId}/guests/${g._id}`} className="font-medium text-accent hover:underline">{g.name}</Link> {g.vip && <Badge value="VIP" tone="info" />}</td>
            <td className="whitespace-nowrap">{g.phone}</td>
            <td className="text-ink-2">{g.email ?? "—"}</td>
            <td className="tabular text-right">{g.bookings}</td>
            <td className="tabular text-right">{g.stays}</td>
            <td className="tabular text-right">{money(g.spent, hotel.currency)}</td>
            <td className="whitespace-nowrap">{day(g.lastStay)}</td>
          </tr>
        ))}
      </Table>
      <Pagination page={data.page} pages={data.pages} total={data.total} href={(p) => `/h/${hotelId}/guests?${new URLSearchParams({ ...(q ? { q } : {}), page: String(p) })}`} />
    </Card>
  );
}
