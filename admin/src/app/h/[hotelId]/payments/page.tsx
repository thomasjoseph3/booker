import Link from "next/link";
import { Suspense } from "react";
import { api } from "@/lib/api";
import { getHotel } from "@/lib/auth";
import { dateTime, label, money } from "@/lib/format";
import type { Page, Payment } from "@/lib/types";
import { Badge, buttonClass, Card, inputClass, PageHeader, PageSkeleton, Pagination, Table } from "@/components/ui";
import { MarkRefunded } from "./mark-refunded";

export const metadata = { title: "Payments" };

export default function PaymentsPage(props: PageProps<"/h/[hotelId]/payments">) {
  return (
    <>
      <PageHeader title="Payments" subtitle="Advance links, balances collected at the desk, and refunds" />
      <Suspense fallback={<PageSkeleton rows={12} />}>
        <PaymentsContent {...props} />
      </Suspense>
    </>
  );
}

async function PaymentsContent({ params, searchParams }: PageProps<"/h/[hotelId]/payments">) {
  const [{ hotelId }, sp] = await Promise.all([params, searchParams]);
  const kind = typeof sp.kind === "string" ? sp.kind : "";
  const status = typeof sp.status === "string" ? sp.status : "";
  const page = Number(sp.page) || 1;
  const [hotel, data] = await Promise.all([getHotel(hotelId), api<Page<Payment>>(`/hotels/${hotelId}/payments`, { query: { kind, status, page, limit: 30 } })]);
  return (
    <Card pad={false}>
      <form className="flex flex-wrap gap-2 border-b border-line p-3">
        <select name="kind" defaultValue={kind} className={`${inputClass} w-44`}>
          <option value="">Charges & refunds</option><option value="charge">Charges</option><option value="refund">Refunds</option>
        </select>
        <select name="status" defaultValue={status} className={`${inputClass} w-48`}>
          <option value="">Any status</option><option value="paid">Paid</option><option value="created">Link sent (unpaid)</option>
          <option value="expired">Expired</option><option value="refunded">Refunded</option><option value="refund_pending">Refund pending</option>
        </select>
        <button className={buttonClass("primary")}>Filter</button>
      </form>
      <Table head={<tr><th>When</th><th>Booking</th><th>Type</th><th>Method</th><th className="text-right">Amount</th><th>Status</th><th /></tr>} empty="No payments">
        {data.items.map((p) => {
          const booking = typeof p.booking === "string" ? null : p.booking;
          return (
            <tr key={p._id} className="hover:bg-panel-2">
              <td className="whitespace-nowrap">{dateTime(p.paidAt ?? p.createdAt, hotel.timezone)}</td>
              <td className="whitespace-nowrap">{booking && <><Link href={`/h/${hotelId}/bookings/${booking.code}`} className="font-mono text-accent hover:underline">{booking.code}</Link> <span className="text-muted">{booking.guestName}</span></>}</td>
              <td className="capitalize">{p.kind === "refund" ? "refund" : label(p.purpose)}</td>
              <td className="capitalize">{p.provider === "offline" ? label(p.method) : `${p.provider} link`}</td>
              <td className="tabular whitespace-nowrap text-right">{p.kind === "refund" ? "−" : ""}{money(p.amount, p.currency)}</td>
              <td><Badge value={p.status} /></td>
              <td>{p.kind === "refund" && p.status === "refund_pending" && <MarkRefunded hotelId={hotelId} paymentId={p._id} />}</td>
            </tr>
          );
        })}
      </Table>
      <Pagination page={data.page} pages={data.pages} total={data.total} href={(n) => `/h/${hotelId}/payments?${new URLSearchParams({ kind, status, page: String(n) })}`} />
    </Card>
  );
}
