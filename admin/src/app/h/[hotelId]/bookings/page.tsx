import Link from "next/link";
import { Suspense } from "react";
import { api } from "@/lib/api";
import type { Booking, Page } from "@/lib/types";
import { BookingTable } from "@/components/booking-table";
import { buttonClass, Card, inputClass, PageHeader, PageSkeleton, Pagination } from "@/components/ui";

export const metadata = { title: "Bookings" };

const STATUSES = [["", "Any status"], ["pending_payment", "Awaiting payment"], ["confirmed", "Confirmed"], ["checked_in", "Checked in"], ["checked_out", "Checked out"], ["cancelled", "Cancelled"], ["expired", "Expired (unpaid)"], ["no_show", "No-show"]];
const VIEWS = [["", "All dates"], ["arrivals", "Arriving today"], ["departures", "Departing today"], ["in_house", "In house now"]];
const SOURCES = [["", "Any source"], ["phone_agent", "Phone agent"], ["website", "Website"], ["ota", "OTA"], ["admin", "Staff"], ["walk_in", "Walk-in"]];

export default function BookingsPage(props: PageProps<"/h/[hotelId]/bookings">) {
  return (
    <>
      <PageHeader title="Bookings" subtitle="Every reservation across all channels" />
      <Suspense fallback={<PageSkeleton rows={12} />}>
        <BookingsContent {...props} />
      </Suspense>
    </>
  );
}

async function BookingsContent({ params, searchParams }: PageProps<"/h/[hotelId]/bookings">) {
  const [{ hotelId }, sp] = await Promise.all([params, searchParams]);
  const get = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string) : "");
  const query = { q: get("q"), status: get("status"), view: get("view"), source: get("source"), from: get("from"), to: get("to"), page: get("page") || 1, limit: 25 };
  const data = await api<Page<Booking>>(`/hotels/${hotelId}/bookings`, { query });
  const qs = (page: number) => {
    const p = new URLSearchParams(Object.entries({ ...query, page: String(page) }).filter(([k, v]) => v && k !== "limit") as [string, string][]);
    return `/h/${hotelId}/bookings?${p}`;
  };
  const select = (name: string, options: string[][]) => (
    <select name={name} defaultValue={get(name)} className={inputClass}>
      {options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
    </select>
  );
  return (
    <Card pad={false}>
      <form className="grid gap-2 border-b border-line p-3 sm:grid-cols-2 lg:grid-cols-[2fr_1fr_1fr_1fr_1fr_1fr_auto]">
        <input name="q" defaultValue={get("q")} placeholder="Search code, guest, phone, email" className={inputClass} />
        {select("status", STATUSES)}
        {select("view", VIEWS)}
        {select("source", SOURCES)}
        <input type="date" name="from" defaultValue={get("from")} title="Staying on or after" className={inputClass} />
        <input type="date" name="to" defaultValue={get("to")} title="Staying on or before" className={inputClass} />
        <div className="flex gap-2">
          <button className={buttonClass("primary")}>Filter</button>
          <Link href={`/h/${hotelId}/bookings`} className={buttonClass()}>Reset</Link>
        </div>
      </form>
      <BookingTable hotelId={hotelId} items={data.items} empty="No bookings match these filters" />
      <Pagination page={data.page} pages={data.pages} total={data.total} href={qs} />
    </Card>
  );
}
