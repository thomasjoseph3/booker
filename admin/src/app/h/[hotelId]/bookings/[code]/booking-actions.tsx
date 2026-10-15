"use client";

import { useState } from "react";
import * as A from "@/lib/actions";
import type { BookingStatus, CancellationQuote } from "@/lib/types";
import { money } from "@/lib/format";
import { useAction } from "@/components/use-action";
import { Flash } from "@/components/flash";
import { buttonClass, Card, Field, inputClass } from "@/components/ui";

type B = {
  code: string; status: BookingStatus; balanceDue: number; checkIn: string; checkOut: string; roomsCount: number;
  adults: number; children: number; currency: string; paymentMode: string; specialRequests: string;
};
type Panel = null | "checkin" | "pay" | "cancel" | "modify" | "note";

export function BookingActions({ hotelId, booking: b, rooms, quote, today }: { hotelId: string; booking: B; rooms: { id: string; number: string }[]; quote: CancellationQuote; canManage: boolean; today: string }) {
  const [panel, setPanel] = useState<Panel>(null);
  const { pending, result, run, clear } = useAction();
  const open = (p: Panel) => { clear(); setPanel(panel === p ? null : p); };
  const done = () => setPanel(null);
  const active = ["pending_payment", "confirmed", "checked_in"].includes(b.status);
  const arrivalDue = today >= b.checkIn && today < b.checkOut;

  return (
    <Card title="Actions">
      <div className="flex flex-wrap gap-2">
        {b.status === "confirmed" && arrivalDue && <button className={buttonClass("primary")} onClick={() => open("checkin")}>Check in</button>}
        {b.status === "checked_in" && (
          <button className={buttonClass("primary")} disabled={pending} onClick={() => run(() => A.checkOut(hotelId, b.code))}>Check out</button>
        )}
        {active && <button className={buttonClass()} onClick={() => open("pay")}>Record payment</button>}
        {active && b.status !== "checked_in" && b.paymentMode === "online" && (
          <button className={buttonClass()} disabled={pending} onClick={() => run(() => A.sendPaymentLink(hotelId, b.code))}>
            {b.status === "pending_payment" ? "Resend payment link" : "Send balance link"}
          </button>
        )}
        {quote.cancellable && <button className={buttonClass()} onClick={() => open("modify")}>Change stay</button>}
        {b.status === "confirmed" && today >= b.checkIn && <button className={buttonClass()} disabled={pending} onClick={() => run(() => A.markNoShow(hotelId, b.code))}>No-show</button>}
        {quote.cancellable && <button className={buttonClass("danger")} onClick={() => open("cancel")}>Cancel…</button>}
        <button className={buttonClass()} onClick={() => open("note")}>Add note</button>
      </div>

      {b.status === "confirmed" && !arrivalDue && today < b.checkIn && <p className="mt-2 text-xs text-muted">Check-in opens on the arrival date.</p>}
      <div className="mt-3 space-y-3">
        <Flash result={result} />
        {result && !result.ok && result.message?.includes("Balance") && b.status === "checked_in" && (
          <button className={buttonClass("danger")} disabled={pending} onClick={() => run(() => A.checkOut(hotelId, b.code, true))}>Check out anyway (leave balance open)</button>
        )}

        {panel === "checkin" && (
          <form className="space-y-3 rounded-lg border border-line p-3" onSubmit={(e) => {
            e.preventDefault();
            const ids = new FormData(e.currentTarget).getAll("room").map(String).filter(Boolean);
            run(() => A.checkIn(hotelId, b.code, ids), done);
          }}>
            {rooms.length > 0 ? (
              Array.from({ length: b.roomsCount }, (_, i) => (
                <Field key={i} label={b.roomsCount > 1 ? `Room ${i + 1}` : "Room"}>
                  <select name="room" defaultValue={rooms[i]?.id ?? ""} className={inputClass}>
                    {rooms.map((r) => <option key={r.id} value={r.id}>Room {r.number}</option>)}
                  </select>
                </Field>
              ))
            ) : <p className="text-xs text-muted">No clean rooms of this type are marked available; check in without a room assignment or update room status first.</p>}
            <button className={buttonClass("primary")} disabled={pending}>Confirm check-in</button>
          </form>
        )}

        {panel === "pay" && (
          <form className="space-y-3 rounded-lg border border-line p-3" onSubmit={(e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            run(() => A.recordPayment(hotelId, b.code, { amount: Number(f.get("amount")), method: String(f.get("method")), note: String(f.get("note") || "") || undefined }), done);
          }}>
            <div className="grid grid-cols-2 gap-2">
              <Field label="Amount"><input name="amount" type="number" step="0.01" min="0.01" required defaultValue={b.balanceDue || ""} className={inputClass} /></Field>
              <Field label="Method">
                <select name="method" className={inputClass}>
                  <option value="upi">UPI</option><option value="card">Card</option><option value="cash">Cash</option><option value="bank_transfer">Bank transfer</option><option value="other">Other</option>
                </select>
              </Field>
            </div>
            <Field label="Reference / note"><input name="note" className={inputClass} placeholder="UPI ref, last 4 digits…" /></Field>
            <button className={buttonClass("primary")} disabled={pending}>Record payment</button>
          </form>
        )}

        {panel === "modify" && (
          <form className="space-y-3 rounded-lg border border-line p-3" onSubmit={(e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            const body: Record<string, unknown> = {};
            for (const k of ["checkIn", "checkOut"] as const) if (f.get(k) !== b[k]) body[k] = f.get(k);
            for (const k of ["roomsCount", "adults", "children"] as const) if (Number(f.get(k)) !== b[k]) body[k] = Number(f.get(k));
            if (f.get("specialRequests") !== b.specialRequests) body.specialRequests = f.get("specialRequests");
            if (!Object.keys(body).length) return;
            run(() => A.modifyBooking(hotelId, b.code, body), done);
          }}>
            <div className="grid grid-cols-2 gap-2">
              <Field label="Check-in"><input name="checkIn" type="date" defaultValue={b.checkIn} className={inputClass} /></Field>
              <Field label="Check-out"><input name="checkOut" type="date" defaultValue={b.checkOut} className={inputClass} /></Field>
              <Field label="Rooms"><input name="roomsCount" type="number" min="1" defaultValue={b.roomsCount} className={inputClass} /></Field>
              <Field label="Adults"><input name="adults" type="number" min="1" defaultValue={b.adults} className={inputClass} /></Field>
              <Field label="Children"><input name="children" type="number" min="0" defaultValue={b.children} className={inputClass} /></Field>
            </div>
            <Field label="Special requests"><input name="specialRequests" defaultValue={b.specialRequests} className={inputClass} /></Field>
            <p className="text-xs text-muted">Price is recalculated. Extra advance is requested on WhatsApp; overpayment is refunded.</p>
            <button className={buttonClass("primary")} disabled={pending}>Save changes</button>
          </form>
        )}

        {panel === "cancel" && quote.cancellable && (
          <form className="space-y-3 rounded-lg border border-bad/30 p-3" onSubmit={(e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            run(() => A.cancelBooking(hotelId, b.code, { reason: String(f.get("reason") || "") || undefined, waiveFee: f.get("waive") === "on" }), done);
          }}>
            <p className="text-xs text-ink-2">{quote.policy}</p>
            <div className="grid grid-cols-3 gap-2 text-center">
              <div className="rounded-lg bg-panel-2 p-2"><div className="text-xs text-muted">Paid</div><div className="tabular font-semibold">{money(quote.amountPaid, b.currency)}</div></div>
              <div className="rounded-lg bg-panel-2 p-2"><div className="text-xs text-muted">Fee</div><div className="tabular font-semibold">{money(quote.fee, b.currency)}</div></div>
              <div className="rounded-lg bg-panel-2 p-2"><div className="text-xs text-muted">Refund</div><div className="tabular font-semibold">{money(quote.refundAmount, b.currency)}</div></div>
            </div>
            <p className="text-xs text-muted">{quote.freeCancellation ? "Inside the free-cancellation window." : `${quote.hoursBeforeCheckIn} hours before check-in — late cancellation fee applies.`}</p>
            <Field label="Reason"><input name="reason" className={inputClass} placeholder="Guest request" /></Field>
            {!quote.freeCancellation && (quote.fee ?? 0) > 0 && (
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="waive" /> Waive the fee (full refund)</label>
            )}
            <button className={buttonClass("danger")} disabled={pending}>Confirm cancellation</button>
          </form>
        )}

        {panel === "note" && (
          <form className="space-y-3 rounded-lg border border-line p-3" onSubmit={(e) => {
            e.preventDefault();
            const note = String(new FormData(e.currentTarget).get("note") || "");
            if (note) run(() => A.addBookingNote(hotelId, b.code, note), done);
          }}>
            <Field label="Internal note"><textarea name="note" rows={3} className={inputClass} required /></Field>
            <button className={buttonClass("primary")} disabled={pending}>Add note</button>
          </form>
        )}
      </div>
    </Card>
  );
}
