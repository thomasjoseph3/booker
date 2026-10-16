import Link from "next/link";
import clsx from "clsx";
import { Suspense } from "react";
import { api } from "@/lib/api";
import { getHotel } from "@/lib/auth";
import { dateTime } from "@/lib/format";
import type { Page, Ticket } from "@/lib/types";
import { Badge, Card, PageHeader, PageSkeleton, Pagination } from "@/components/ui";
import { TicketControls } from "./ticket-controls";
import { TypeFilter } from "./type-filter";

export const metadata = { title: "Tickets" };

const TYPES: Record<string, { icon: string; text: string }> = {
  callback: { icon: "☎", text: "Call back" },
  question: { icon: "?", text: "Question" },
  complaint: { icon: "!", text: "Complaint" },
  booking_help: { icon: "▤", text: "Booking help" },
  group_booking: { icon: "☺", text: "Group booking" },
  payment: { icon: "₹", text: "Payment" },
  special_request: { icon: "✦", text: "Special request" },
  system: { icon: "⚙", text: "System" },
};
const TABS = [
  ["todo", "To do"],
  ["urgent", "Urgent"],
  ["done", "Done"],
] as const;
const QUERY = {
  todo: { status: "open,in_progress", priority: "" },
  urgent: { status: "open,in_progress", priority: "high" },
  done: { status: "done", priority: "" },
} as const;
const PRIORITY_STYLE = {
  high: { bar: "bg-bad", text: "Urgent" },
  normal: { bar: "bg-warn", text: "Normal" },
  low: { bar: "bg-line", text: "Low" },
} as const;

export default function TicketsPage(props: PageProps<"/h/[hotelId]/tickets">) {
  return (
    <>
      <PageHeader title="Tickets" subtitle="Guests the AI agent could not fully help. Call them back or answer their question." />
      <Suspense fallback={<PageSkeleton rows={8} />}>
        <TicketsContent {...props} />
      </Suspense>
    </>
  );
}

const pick = (v: string | string[] | undefined) => (typeof v === "string" ? v : "");

function ago(iso: string) {
  const m = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  if (m < 1) return "just now";
  if (m < 60) return `${m} min ago`;
  if (m < 1440) return `${Math.round(m / 60)} h ago`;
  return `${Math.round(m / 1440)} d ago`;
}

async function TicketsContent({ params, searchParams }: PageProps<"/h/[hotelId]/tickets">) {
  const [{ hotelId }, sp] = await Promise.all([params, searchParams]);
  const tab = (["todo", "urgent", "done"] as const).find((t) => t === pick(sp.tab)) ?? "todo";
  const type = pick(sp.type);
  const page = Number(sp.page) || 1;
  const { status, priority } = QUERY[tab];
  const nUrgent = api<Page<Ticket>>(`/hotels/${hotelId}/callbacks`, { query: { status: "open,in_progress", priority: "high", limit: 1 } }).then((r) => r.total);
  const [hotel, data, urgent] = await Promise.all([
    getHotel(hotelId),
    api<Page<Ticket>>(`/hotels/${hotelId}/callbacks`, { query: { status, priority, type, page, limit: 20 } }),
    nUrgent,
  ]);
  const url = (o: { tab?: string; page?: number }) => `/h/${hotelId}/tickets?${new URLSearchParams({ tab, type, page: "1", ...Object.fromEntries(Object.entries(o).map(([k, v]) => [k, String(v)])) })}`;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="inline-flex rounded-lg border border-line bg-panel p-1">
          {TABS.map(([k, t]) => (
            <Link key={k} href={url({ tab: k })}
              className={clsx("rounded-md px-4 py-1.5 transition-colors", tab === k ? "bg-accent text-accent-ink font-medium" : "text-ink-2 hover:bg-panel-2")}>
              {t}{k === "urgent" && urgent > 0 && <span className="ml-1.5 rounded-full bg-bad px-1.5 text-xs text-white">{urgent}</span>}
            </Link>
          ))}
        </div>
        <TypeFilter value={type} options={Object.entries(TYPES).map(([k, v]) => [k, `${v.icon} ${v.text}`])} />
      </div>

      {data.items.length === 0 ? (
        <Card><p className="py-10 text-center text-muted">🎉 Nothing here. No tickets match these filters.</p></Card>
      ) : (
        <div className="space-y-3">
          {data.items.map((t) => {
            const ty = TYPES[t.type] ?? TYPES.callback;
            const pr = PRIORITY_STYLE[t.priority] ?? PRIORITY_STYLE.normal;
            return (
              <article key={t._id} className={clsx("flex overflow-hidden rounded-xl border border-line bg-panel", t.status === "done" && "opacity-70")}>
                <div className={clsx("w-1.5 shrink-0", pr.bar)} />
                <div className="min-w-0 flex-1 space-y-3 p-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="grid size-7 place-items-center rounded-lg bg-panel-2 text-ink-2">{ty.icon}</span>
                    <span className="font-semibold">{ty.text}</span>
                    <Badge value={t.priority} tone={t.priority === "high" ? "bad" : t.priority === "normal" ? "warn" : "neutral"} />
                    <Badge value={t.status} />
                    <span className="ml-auto text-xs text-muted" title={dateTime(t.createdAt, hotel.timezone)}>{ago(t.createdAt)}</span>
                  </div>
                  <p className="whitespace-pre-line text-[15px] leading-relaxed">{t.reason}</p>
                  <div className="flex flex-wrap items-center gap-x-5 gap-y-1 text-ink-2">
                    <span>👤 {t.name || "Unknown guest"}</span>
                    <a href={`tel:${t.phone}`} className="font-medium text-accent hover:underline">📞 {t.phone}</a>
                    {t.booking && <Link href={`/h/${hotelId}/bookings/${t.booking.code}`} className="font-mono text-accent hover:underline">Booking {t.booking.code}</Link>}
                    {t.callId && t.createdBy?.startsWith("agent") && <span className="text-xs text-muted">raised by the AI agent</span>}
                  </div>
                  <TicketControls hotelId={hotelId} ticket={{ _id: t._id, status: t.status, priority: t.priority, notes: t.notes ?? "" }} />
                </div>
              </article>
            );
          })}
        </div>
      )}
      <Pagination page={data.page} pages={data.pages} total={data.total} href={(p) => url({ page: p })} />
    </div>
  );
}
