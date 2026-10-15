"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import * as A from "@/lib/actions";
import type { AvailabilityOption } from "@/lib/types";
import { money } from "@/lib/format";
import { useAction } from "@/components/use-action";
import { Flash } from "@/components/flash";
import { Badge, buttonClass, Card, Field, inputClass } from "@/components/ui";

import { addDaysIso } from "@/lib/dates";

export function NewBookingForm({ hotelId, hotelName, currency, holdMinutes, today }: { hotelId: string; hotelName: string; currency: string; allowPayAtHotel: boolean; holdMinutes: number; today: string }) {
  const router = useRouter();
  const search = useAction();
  const create = useAction();
  const [stay, setStay] = useState({ checkIn: today, checkOut: addDaysIso(today, 1), adults: 2, children: 0, roomsCount: 1 });
  const [options, setOptions] = useState<AvailabilityOption[] | null>(null);
  const [picked, setPicked] = useState<AvailabilityOption | null>(null);

  return (
    <div className="grid gap-4 xl:grid-cols-[1fr_380px]">
      <div className="space-y-4">
        <Card title="1 · Dates and guests">
          <form className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6" onSubmit={(e) => {
            e.preventDefault();
            setPicked(null);
            search.run(() => A.searchAvailability(hotelId, stay), (d) => setOptions(d.options));
          }}>
            <Field label="Check-in"><input type="date" required value={stay.checkIn} onChange={(e) => setStay({ ...stay, checkIn: e.target.value })} className={inputClass} /></Field>
            <Field label="Check-out"><input type="date" required value={stay.checkOut} onChange={(e) => setStay({ ...stay, checkOut: e.target.value })} className={inputClass} /></Field>
            <Field label="Adults"><input type="number" min={1} value={stay.adults} onChange={(e) => setStay({ ...stay, adults: Number(e.target.value) })} className={inputClass} /></Field>
            <Field label="Children"><input type="number" min={0} value={stay.children} onChange={(e) => setStay({ ...stay, children: Number(e.target.value) })} className={inputClass} /></Field>
            <Field label="Rooms"><input type="number" min={1} value={stay.roomsCount} onChange={(e) => setStay({ ...stay, roomsCount: Number(e.target.value) })} className={inputClass} /></Field>
            <div className="flex items-end"><button className={buttonClass("primary", "w-full")} disabled={search.pending}>{search.pending ? "Checking…" : "Check availability"}</button></div>
          </form>
          {search.result && !search.result.ok && <div className="mt-3"><Flash result={search.result} /></div>}
        </Card>

        {options && (
          <Card title={`2 · Choose a room at ${hotelName}`} pad={false}>
            <ul className="divide-y divide-line">
              {options.map((o) => (
                <li key={o.roomTypeId} className={`flex flex-wrap items-center gap-4 px-4 py-3 ${picked?.roomTypeId === o.roomTypeId ? "bg-accent-soft" : ""}`}>
                  <div className="min-w-56 flex-1">
                    <div className="font-medium">{o.name} <span className="text-xs text-muted">· {o.bedType} · up to {o.maxAdults}A + {o.maxChildren}C</span></div>
                    <div className="text-xs text-muted">{o.bookable ? `${o.availableRooms} available · ${o.roomsNeeded} room(s) for this party` : o.reason}</div>
                  </div>
                  <div className="tabular text-right">
                    <div className="font-semibold">{money(o.quote.total, currency)} <span className="text-xs font-normal text-muted">total incl. tax</span></div>
                    <div className="text-xs text-muted">
                      {o.quote.roomsCount > 1 && `${o.quote.roomsCount} rooms × `}{money(o.quote.averageNightlyRate, currency)}/night × {o.quote.nights} night{o.quote.nights > 1 ? "s" : ""} + {o.quote.taxPercent}% tax
                    </div>
                  </div>
                  {o.bookable ? (
                    <button className={buttonClass(picked?.roomTypeId === o.roomTypeId ? "primary" : "secondary")} onClick={() => setPicked(o)}>
                      {picked?.roomTypeId === o.roomTypeId ? "Selected" : "Select"}
                    </button>
                  ) : <Badge value="unavailable" tone="neutral" />}
                </li>
              ))}
            </ul>
          </Card>
        )}
      </div>

      {picked && (
        <Card title="3 · Guest and payment" className="h-fit">
          <form className="space-y-3" onSubmit={(e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            create.run(() => A.createBooking(hotelId, {
              ...stay, roomsCount: picked.roomsNeeded ?? stay.roomsCount, roomTypeId: picked.roomTypeId,
              guest: { name: f.get("name"), phone: f.get("phone"), email: f.get("email") || undefined },
              paymentMode: f.get("paymentMode"), source: f.get("source"), specialRequests: f.get("specialRequests") || undefined,
            }), (d) => router.push(`/h/${hotelId}/bookings/${d.code}`));
          }}>
            <div className="rounded-lg bg-panel-2 p-3 text-xs">
              <div className="font-medium text-ink">{picked.roomsNeeded} × {picked.name}</div>
              <div className="tabular mt-1 text-ink-2">Total {money(picked.quote.total, currency)} · advance {money(picked.quote.advanceDue, currency)}</div>
            </div>
            <Field label="Guest name"><input name="name" required className={inputClass} /></Field>
            <Field label="Mobile (WhatsApp)" hint="Payment link and confirmation go to this number"><input name="phone" required placeholder="+91 98470 12345" className={inputClass} /></Field>
            <Field label="Email (optional)"><input name="email" type="email" className={inputClass} /></Field>
            <Field label="Payment">
              <select name="paymentMode" className={inputClass}>
                <option value="online">Send advance link on WhatsApp ({holdMinutes}-min hold)</option>
                <option value="pay_at_hotel">Pay at hotel (confirm now)</option>
              </select>
            </Field>
            <Field label="Source">
              <select name="source" className={inputClass}>
                <option value="admin">Phone (staff)</option><option value="walk_in">Walk-in</option><option value="ota">OTA</option><option value="website">Website</option>
              </select>
            </Field>
            <Field label="Special requests"><input name="specialRequests" className={inputClass} /></Field>
            <Flash result={create.result && !create.result.ok ? create.result : null} />
            <button className={buttonClass("primary", "w-full")} disabled={create.pending}>{create.pending ? "Creating…" : "Create booking"}</button>
          </form>
        </Card>
      )}
    </div>
  );
}
