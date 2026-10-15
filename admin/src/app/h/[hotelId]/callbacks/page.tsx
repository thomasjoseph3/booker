import Link from "next/link";
import { Suspense } from "react";
import clsx from "clsx";
import { api } from "@/lib/api";
import { getHotel } from "@/lib/auth";
import type { Callback, Page } from "@/lib/types";
import { Card, PageHeader, PageSkeleton, Pagination } from "@/components/ui";
import { CallbackRow } from "./callback-row";

export const metadata = { title: "Callbacks" };
const TABS = [["open,in_progress", "To do"], ["done", "Done"], ["", "All"]];

export default function CallbacksPage(props: PageProps<"/h/[hotelId]/callbacks">) {
  return (
    <>
      <PageHeader title="Callbacks" subtitle="Hand-offs from the agent and system alerts that need a person" />
      <Suspense fallback={<PageSkeleton rows={8} />}>
        <CallbacksContent {...props} />
      </Suspense>
    </>
  );
}

async function CallbacksContent({ params, searchParams }: PageProps<"/h/[hotelId]/callbacks">) {
  const [{ hotelId }, sp] = await Promise.all([params, searchParams]);
  const status = typeof sp.status === "string" ? sp.status : "open,in_progress";
  const page = Number(sp.page) || 1;
  const [hotel, data] = await Promise.all([getHotel(hotelId), api<Page<Callback>>(`/hotels/${hotelId}/callbacks`, { query: { status, page, limit: 30 } })]);
  return (
    <Card pad={false}>
      <div className="flex gap-1 border-b border-line p-2">
        {TABS.map(([v, l]) => (
          <Link key={l} href={`/h/${hotelId}/callbacks?status=${v}`} className={clsx("rounded-lg px-3 py-1.5", v === status ? "bg-accent-soft font-medium text-accent" : "text-ink-2 hover:bg-panel-2")}>{l}</Link>
        ))}
      </div>
      {data.items.length === 0 ? <p className="p-10 text-center text-muted">Nothing waiting. 🎉</p> : (
        <ul className="divide-y divide-line">
          {data.items.map((c) => <CallbackRow key={c._id} hotelId={hotelId} cb={c} tz={hotel.timezone} />)}
        </ul>
      )}
      <Pagination page={data.page} pages={data.pages} total={data.total} href={(p) => `/h/${hotelId}/callbacks?status=${status}&page=${p}`} />
    </Card>
  );
}
