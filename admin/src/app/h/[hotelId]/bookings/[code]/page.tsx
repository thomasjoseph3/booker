import Link from "next/link";
import { Suspense } from "react";
import { api } from "@/lib/api";
import { getHotel, getMe, isManager } from "@/lib/auth";
import { dateTime, day, label, money, sourceLabel } from "@/lib/format";
import { todayIso } from "@/lib/dates";
import type { Booking, CallLog, CancellationQuote, Notification, Payment, Room } from "@/lib/types";
import { Badge, Card, PageHeader, PageSkeleton, Table, WhatsAppText } from "@/components/ui";
import { BookingActions } from "./booking-actions";

export const metadata = { title: "Booking" };

type Detail = { booking: Booking; payments: Payment[]; notifications: Notification[]; calls: CallLog[]; cancellationQuote: CancellationQuote };

export default function BookingPage(props: PageProps<"/h/[hotelId]/bookings/[code]">) {
  return (
    <Suspense fallback={<PageSkeleton tiles={4} />}>
      <BookingContent {...props} />
    </Suspense>
  );
}

function Row({ k, children }: { k: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[130px_1fr] gap-3 py-1.5">
      <dt className="text-muted">{k}</dt>
      <dd>{children}</dd>
    </div>
  );
}

async function BookingContent({ params }: PageProps<"/h/[hotelId]/bookings/[code]">) {
  const { hotelId, code } = await params;
  const [hotel, me, detail] = await Promise.all([getHotel(hotelId), getMe(), api<Detail>(`/hotels/${hotelId}/bookings/${encodeURIComponent(code)}`)]);
  const { booking: b, payments, notifications, calls, cancellationQuote } = detail;
  const rooms = b.status === "confirmed"
    ? (await api<{ items: Room[] }>(`/hotels/${hotelId}/rooms`, { query: { roomTypeId: b.roomType, status: "available" } })).items
    : [];
  const c = b.currency;
  const tz = hotel.timezone;
  const netPaid = b.amountPaid - b.amountRefunded;
  const guestId = typeof b.guest === "string" ? b.guest : b.guest._id;

  return (
    <>
      <PageHeader
        title={`Booking ${b.code}`}
        subtitle={<span className="inline-flex flex-wrap items-center gap-2"><Badge value={b.status} /> created {dateTime(b.createdAt, tz)} via {sourceLabel(b.source)}</span>}
        actions={<Link href={`/h/${hotelId}/bookings`} className="text-sm text-accent">← All bookings</Link>}
      />

      {b.status === "pending_payment" && b.holdExpiresAt && (
        <div className="mb-4 rounded-xl border border-warn/30 bg-warn-soft px-4 py-3 text-warn">
          Room on hold until <b>{dateTime(b.holdExpiresAt, tz)}</b>. Advance of {money(b.advanceDue - netPaid, c)} has been requested on WhatsApp; the hold is released automatically if it isn&apos;t paid.
        </div>
      )}

      <div className="grid gap-4 xl:grid-cols-3">
        <div className="min-w-0 space-y-4 xl:col-span-2">
          <div className="grid gap-4 md:grid-cols-2">
            <Card title="Stay">
              <dl>
                <Row k="Room">{b.roomsCount} × {b.roomTypeName}{b.assignedRooms?.length ? <span className="text-muted"> · room {b.assignedRooms.map((r) => r.number).join(", ")}</span> : null}</Row>
                <Row k="Check-in">{day(b.checkIn)} <span className="text-muted">from {hotel.checkInTime}</span></Row>
                <Row k="Check-out">{day(b.checkOut)} <span className="text-muted">by {hotel.checkOutTime}</span></Row>
                <Row k="Nights">{b.nights}</Row>
                {b.checkedInAt && <Row k="Checked in">{dateTime(b.checkedInAt, tz)}</Row>}
                {b.checkedOutAt && <Row k="Vacated">{dateTime(b.checkedOutAt, tz)}</Row>}
                <Row k="Guests">{b.adults} adult{b.adults > 1 ? "s" : ""}{b.children ? `, ${b.children} child${b.children > 1 ? "ren" : ""}` : ""}</Row>
                <Row k="Requests">{b.specialRequests || <span className="text-muted">—</span>}</Row>
              </dl>
            </Card>
            <Card title="Guest" actions={<Link href={`/h/${hotelId}/guests/${guestId}`} className="text-xs text-accent">Profile →</Link>}>
              <dl>
                <Row k="Name">{b.guestName}</Row>
                <Row k="Phone">{b.guestPhone}</Row>
                <Row k="Email">{b.guestEmail || <span className="text-muted">—</span>}</Row>
                {typeof b.guest !== "string" && b.guest.vip && <Row k="Status"><Badge value="VIP" tone="info" /></Row>}
                {typeof b.guest !== "string" && b.guest.notes && <Row k="Notes">{b.guest.notes}</Row>}
              </dl>
            </Card>
          </div>

          <Card title="Charges & payments" pad={false}>
            <div className="grid gap-x-6 border-b border-line p-4 sm:grid-cols-2">
              <dl>
                {(b.nightlyRates ?? []).length <= 7 && b.nightlyRates?.map((n) => (
                  <Row key={n.date} k={day(n.date)}><span className="tabular">{money(n.price, c)}{b.roomsCount > 1 && ` × ${b.roomsCount}`}</span></Row>
                ))}
                {b.discountName && <Row k={`Offer: ${b.discountName} (${b.discountPercent}% off)`}><span className="tabular text-ok">−{money(b.discountAmount, c)}</span></Row>}
                <Row k="Subtotal"><span className="tabular">{money(b.subtotal, c)}</span></Row>
                <Row k={`Tax (${hotel.taxPercent}%)`}><span className="tabular">{money(b.tax, c)}</span></Row>
                <Row k="Total"><span className="tabular font-semibold">{money(b.total, c)}</span></Row>
              </dl>
              <dl>
                <Row k="Payment mode"><span className="capitalize">{label(b.paymentMode)}</span></Row>
                <Row k="Advance due"><span className="tabular">{money(b.advanceDue, c)}</span></Row>
                <Row k="Paid"><span className="tabular">{money(b.amountPaid, c)}</span></Row>
                <Row k="Refunded"><span className="tabular">{money(b.amountRefunded, c)}</span></Row>
                <Row k="Balance"><span className="tabular font-semibold">{money(b.balanceDue, c)}</span></Row>
              </dl>
            </div>
            <Table head={<tr><th>When</th><th>Type</th><th>Method</th><th className="text-right">Amount</th><th>Status</th><th /></tr>} empty="No payments yet">
              {payments.map((p) => (
                <tr key={p._id}>
                  <td className="whitespace-nowrap">{dateTime(p.paidAt ?? p.createdAt, tz)}</td>
                  <td className="capitalize">{p.kind === "refund" ? "refund" : label(p.purpose)}</td>
                  <td className="capitalize">{p.provider === "offline" ? label(p.method) : `${p.provider} link`}</td>
                  <td className="tabular text-right">{p.kind === "refund" ? "−" : ""}{money(p.amount, c)}</td>
                  <td><Badge value={p.status} /></td>
                  <td>{p.status === "created" && p.paymentUrl && <a href={p.paymentUrl} target="_blank" rel="noreferrer" className="text-xs text-accent">Open link ↗</a>}</td>
                </tr>
              ))}
            </Table>
          </Card>

          <Card title={`WhatsApp messages (${notifications.length})`}>
            {notifications.length === 0 ? <p className="text-muted">No messages sent.</p> : (
              <div className="space-y-3">
                {notifications.map((n) => (
                  <div key={n._id} className="max-w-xl rounded-xl rounded-tl-sm border border-line bg-panel-2 p-3">
                    <div className="mb-1.5 flex flex-wrap items-center gap-2 text-xs text-muted">
                      <span className="capitalize">{label(n.template)}</span>· {dateTime(n.createdAt, tz)} · <Badge value={n.status} />
                    </div>
                    <WhatsAppText text={n.message} />
                    {n.error && <p className="mt-1 text-xs text-bad">{n.error}</p>}
                  </div>
                ))}
              </div>
            )}
          </Card>
        </div>

        <div className="space-y-4">
          <BookingActions
            hotelId={hotelId}
            booking={{ code: b.code, status: b.status, balanceDue: b.balanceDue, checkIn: b.checkIn, checkOut: b.checkOut, roomsCount: b.roomsCount, adults: b.adults, children: b.children, currency: c, paymentMode: b.paymentMode, specialRequests: b.specialRequests ?? "" }}
            rooms={rooms.map((r) => ({ id: r._id, number: r.number }))}
            quote={cancellationQuote}
            canManage={isManager(me)}
            today={todayIso(tz)}
          />

          {b.cancellation?.at && (
            <Card title="Cancellation">
              <dl>
                <Row k="When">{dateTime(b.cancellation.at, tz)}</Row>
                <Row k="By">{b.cancellation.by}</Row>
                <Row k="Reason">{b.cancellation.reason}</Row>
                <Row k="Fee kept">{money(b.cancellation.fee, c)}</Row>
                <Row k="Refund">{money(b.cancellation.refundAmount, c)}</Row>
              </dl>
            </Card>
          )}

          {calls.length > 0 && (
            <Card title="Related calls" pad={false}>
              <ul className="divide-y divide-line">
                {calls.map((call) => (
                  <li key={call._id} className="px-4 py-2.5">
                    <Link href={`/h/${hotelId}/calls/${call._id}`} className="font-medium text-accent hover:underline">{dateTime(call.createdAt, tz)}</Link>
                    <span className="ml-2"><Badge value={call.outcome} /></span>
                    <p className="mt-0.5 text-xs text-ink-2">{call.summary}</p>
                  </li>
                ))}
              </ul>
            </Card>
          )}

          <Card title="Timeline" pad={false}>
            <ol className="relative space-y-0 py-2">
              {[...b.history].reverse().map((h, i) => (
                <li key={i} className="flex gap-3 px-4 py-2">
                  <span className="mt-1.5 size-2 shrink-0 rounded-full bg-accent" />
                  <div className="min-w-0">
                    <div className="font-medium capitalize">{label(h.action)}</div>
                    <div className="text-xs text-muted">{dateTime(h.at, tz)} · {h.by}</div>
                    {h.note && <div className="mt-0.5 break-words text-xs text-ink-2">{h.note}</div>}
                  </div>
                </li>
              ))}
            </ol>
          </Card>
        </div>
      </div>
    </>
  );
}
