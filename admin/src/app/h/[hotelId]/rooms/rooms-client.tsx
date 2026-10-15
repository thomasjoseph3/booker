"use client";

import { useState } from "react";
import clsx from "clsx";
import * as A from "@/lib/actions";
import type { Room, RoomType } from "@/lib/types";
import { dateTime, label, money, shortDay, time } from "@/lib/format";
import Link from "next/link";
import { useAction } from "@/components/use-action";
import { Flash } from "@/components/flash";
import { Badge, buttonClass, Card, Field, inputClass } from "@/components/ui";

type Override = { from: string; to: string; price: number; label?: string };

function RoomTypeForm({ hotelId, rt, onDone }: { hotelId: string; rt: RoomType | null; onDone: () => void }) {
  const { pending, result, run } = useAction();
  const [overrides, setOverrides] = useState<Override[]>(rt?.rateOverrides.map(({ from, to, price, label: l }) => ({ from, to, price, label: l })) ?? []);
  return (
    <form className="space-y-4 border-t border-line bg-panel-2 p-4" onSubmit={(e) => {
      e.preventDefault();
      const f = new FormData(e.currentTarget);
      const num = (k: string) => Number(f.get(k));
      const weekend = String(f.get("weekendPrice") ?? "");
      const body = {
        name: f.get("name"), code: f.get("code"), description: f.get("description") || undefined, bedType: f.get("bedType") || undefined,
        view: f.get("view") || undefined, sizeSqft: f.get("sizeSqft") ? num("sizeSqft") : undefined,
        maxAdults: num("maxAdults"), maxChildren: num("maxChildren"), maxOccupancy: num("maxOccupancy"),
        basePrice: num("basePrice"), weekendPrice: weekend ? Number(weekend) : null, totalRooms: num("totalRooms"),
        amenities: String(f.get("amenities") ?? "").split(",").map((s) => s.trim()).filter(Boolean),
        rateOverrides: overrides.filter((o) => o.from && o.to && o.price >= 0),
        active: f.get("active") === "on",
      };
      run(() => A.saveRoomType(hotelId, rt?._id ?? null, body), onDone);
    }}>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Field label="Name"><input name="name" required defaultValue={rt?.name} className={inputClass} /></Field>
        <Field label="Code"><input name="code" required defaultValue={rt?.code} className={inputClass} /></Field>
        <Field label="Bed type"><input name="bedType" defaultValue={rt?.bedType} className={inputClass} /></Field>
        <Field label="View"><input name="view" defaultValue={rt?.view} className={inputClass} /></Field>
        <Field label="Base price / night"><input name="basePrice" type="number" min={0} required defaultValue={rt?.basePrice} className={inputClass} /></Field>
        <Field label="Weekend price (Fri, Sat)"><input name="weekendPrice" type="number" min={0} defaultValue={rt?.weekendPrice ?? ""} className={inputClass} /></Field>
        <Field label="Rooms to sell" hint="Auto-synced when you manage physical rooms"><input name="totalRooms" type="number" min={0} required defaultValue={rt?.totalRooms ?? 1} className={inputClass} /></Field>
        <Field label="Size (sq ft)"><input name="sizeSqft" type="number" min={0} defaultValue={rt?.sizeSqft} className={inputClass} /></Field>
        <Field label="Max adults"><input name="maxAdults" type="number" min={1} defaultValue={rt?.maxAdults ?? 2} className={inputClass} /></Field>
        <Field label="Max children"><input name="maxChildren" type="number" min={0} defaultValue={rt?.maxChildren ?? 1} className={inputClass} /></Field>
        <Field label="Max guests"><input name="maxOccupancy" type="number" min={1} defaultValue={rt?.maxOccupancy ?? 3} className={inputClass} /></Field>
        <label className="flex items-end gap-2 pb-2"><input type="checkbox" name="active" defaultChecked={rt?.active ?? true} /> Bookable</label>
      </div>
      <Field label="Description (the agent reads this to callers)"><textarea name="description" rows={2} defaultValue={rt?.description} className={inputClass} /></Field>
      <Field label="Amenities (comma separated)"><input name="amenities" defaultValue={rt?.amenities.join(", ")} className={inputClass} /></Field>
      <div>
        <div className="mb-2 flex items-center justify-between">
          <span className="text-xs font-medium text-ink-2">Seasonal rates (override the price for these nights, inclusive)</span>
          <button type="button" className={buttonClass()} onClick={() => setOverrides([...overrides, { from: "", to: "", price: rt?.basePrice ?? 0, label: "" }])}>+ Add season</button>
        </div>
        {overrides.length === 0 && <p className="text-xs text-muted">No seasonal rates.</p>}
        <div className="space-y-2">
          {overrides.map((o, i) => (
            <div key={i} className="grid grid-cols-2 gap-2 sm:grid-cols-[1.5fr_1fr_1fr_1fr_auto]">
              <input placeholder="Label (e.g. Diwali)" value={o.label ?? ""} onChange={(e) => setOverrides(overrides.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))} className={inputClass} />
              <input type="date" value={o.from} onChange={(e) => setOverrides(overrides.map((x, j) => (j === i ? { ...x, from: e.target.value } : x)))} className={inputClass} />
              <input type="date" value={o.to} onChange={(e) => setOverrides(overrides.map((x, j) => (j === i ? { ...x, to: e.target.value } : x)))} className={inputClass} />
              <input type="number" min={0} value={o.price} onChange={(e) => setOverrides(overrides.map((x, j) => (j === i ? { ...x, price: Number(e.target.value) } : x)))} className={inputClass} />
              <button type="button" className={buttonClass("danger")} onClick={() => setOverrides(overrides.filter((_, j) => j !== i))}>Remove</button>
            </div>
          ))}
        </div>
      </div>
      <Flash result={result && !result.ok ? result : null} />
      <div className="flex gap-2">
        <button className={buttonClass("primary")} disabled={pending}>{rt ? "Save room type" : "Create room type"}</button>
        <button type="button" className={buttonClass()} onClick={onDone}>Cancel</button>
      </div>
    </form>
  );
}

export function RoomTypesEditor({ hotelId, types, currency, canManage }: { hotelId: string; types: RoomType[]; currency: string; canManage: boolean }) {
  const [editing, setEditing] = useState<string | null>(null);
  return (
    <Card title="Room types & pricing" pad={false} actions={canManage && <button className={buttonClass("primary")} onClick={() => setEditing("new")}>+ Room type</button>}>
      {editing === "new" && <RoomTypeForm hotelId={hotelId} rt={null} onDone={() => setEditing(null)} />}
      <ul className="divide-y divide-line">
        {types.map((t) => (
          <li key={t._id}>
            <div className="flex flex-wrap items-start gap-4 px-4 py-3">
              <div className="min-w-64 flex-1">
                <div className="flex items-center gap-2 font-medium">{t.name} <span className="font-mono text-xs text-muted">{t.code}</span> {!t.active && <Badge value="inactive" tone="neutral" />}</div>
                <div className="mt-0.5 text-xs text-muted">{[t.bedType && `${t.bedType} bed`, t.view && `${t.view} view`, t.sizeSqft && `${t.sizeSqft} sq ft`, `up to ${t.maxAdults} adults + ${t.maxChildren} children`].filter(Boolean).join(" · ")}</div>
                {t.rateOverrides.length > 0 && (
                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                    {t.rateOverrides.map((o) => <span key={o._id ?? o.from} className="rounded-md bg-warn-soft px-2 py-0.5 text-xs text-warn">{o.label || "Season"}: {o.from} → {o.to} · {money(o.price, currency)}</span>)}
                  </div>
                )}
              </div>
              <div className="tabular grid grid-cols-3 gap-6 text-right">
                <div><div className="text-xs text-muted">Weekday</div><div className="font-semibold">{money(t.basePrice, currency)}</div></div>
                <div><div className="text-xs text-muted">Weekend</div><div className="font-semibold">{t.weekendPrice != null ? money(t.weekendPrice, currency) : "—"}</div></div>
                <div><div className="text-xs text-muted">Rooms</div><div className="font-semibold">{t.totalRooms}</div></div>
              </div>
              {canManage && <button className={buttonClass()} onClick={() => setEditing(editing === t._id ? null : t._id)}>Edit</button>}
            </div>
            {editing === t._id && <RoomTypeForm hotelId={hotelId} rt={t} onDone={() => setEditing(null)} />}
          </li>
        ))}
      </ul>
    </Card>
  );
}

const ROOM_TONE: Record<string, string> = {
  available: "border-ok/30 bg-ok-soft", occupied: "border-info/30 bg-info-soft", cleaning: "border-warn/30 bg-warn-soft", out_of_service: "border-bad/30 bg-bad-soft",
};

function RoomTile({ hotelId, room, tz, today }: { hotelId: string; room: Room; tz: string; today: string }) {
  const { pending, result, run } = useAction();
  const stay = room.currentStay;
  const last = room.lastStay;
  const vacatedToday = last?.checkedOutAt && last.checkOut === today;
  return (
    <div className={clsx("flex flex-col rounded-lg border p-2.5", ROOM_TONE[room.status])}>
      <div className="flex items-center justify-between">
        <span className="text-base font-semibold">{room.number}</span>
        <span className="text-[11px] text-ink-2">{room.roomType?.name}</span>
      </div>
      <div className="mt-1 min-h-9 text-[11px] leading-snug text-ink-2">
        {stay ? (
          <>
            <Link href={`/h/${hotelId}/bookings/${stay.code}`} className="font-medium text-ink hover:underline">{stay.guestName}</Link>
            <div>{stay.adults}A{stay.children ? ` ${stay.children}C` : ""} · leaves {stay.checkOut === today ? "today" : shortDay(stay.checkOut)}</div>
          </>
        ) : room.status === "cleaning" && last?.checkedOutAt ? (
          <>
            <div>Vacated {vacatedToday ? `today ${time(last.checkedOutAt, tz)}` : dateTime(last.checkedOutAt, tz)}</div>
            <div className="truncate">by {last.guestName}</div>
          </>
        ) : room.status === "available" ? (
          <div>Ready{last?.checkedOutAt ? ` · last guest left ${shortDay(last.checkOut)}` : ""}</div>
        ) : room.status === "out_of_service" ? <div>Not for sale</div> : null}
      </div>
      <select aria-label={`Room ${room.number} status`} disabled={pending} value={room.status}
        onChange={(e) => run(() => A.updateRoomStatus(hotelId, room._id, e.target.value))}
        className="mt-1.5 w-full rounded-md border border-line bg-panel px-1.5 py-1 text-xs capitalize">
        {["available", "occupied", "cleaning", "out_of_service"].map((s) => <option key={s} value={s}>{label(s)}</option>)}
      </select>
      {result && !result.ok && <p className="mt-1 text-[11px] text-bad">{result.message}</p>}
    </div>
  );
}

export function RoomsBoard({ hotelId, rooms, types, canManage, tz, today }: { hotelId: string; rooms: Room[]; types: { id: string; name: string }[]; canManage: boolean; tz: string; today: string }) {
  const add = useAction();
  const counts = rooms.reduce<Record<string, number>>((m, r) => ({ ...m, [r.status]: (m[r.status] ?? 0) + 1 }), {});
  return (
    <Card title="Housekeeping board" actions={<span className="text-xs text-muted">{Object.entries(counts).map(([k, v]) => `${v} ${label(k)}`).join(" · ")}</span>}>
      {[...new Set(rooms.map((r) => r.floor ?? ""))].map((floor) => (
        <div key={floor} className="mb-4">
          {floor && <div className="mb-1.5 text-xs font-medium text-muted">Floor {floor}</div>}
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-5 xl:grid-cols-7">
            {rooms.filter((r) => (r.floor ?? "") === floor).map((r) => <RoomTile key={r._id} hotelId={hotelId} room={r} tz={tz} today={today} />)}
          </div>
        </div>
      ))}
      {canManage && (
        <form className="mt-4 flex flex-wrap items-end gap-2 border-t border-line pt-4" onSubmit={(e) => {
          e.preventDefault();
          const f = new FormData(e.currentTarget);
          const form = e.currentTarget;
          add.run(() => A.addRoom(hotelId, { roomTypeId: String(f.get("roomTypeId")), number: String(f.get("number")), floor: String(f.get("floor") || "") || undefined }), () => form.reset());
        }}>
          <Field label="Room number"><input name="number" required className={inputClass} /></Field>
          <Field label="Floor"><input name="floor" className={inputClass} /></Field>
          <Field label="Type">
            <select name="roomTypeId" className={inputClass}>{types.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</select>
          </Field>
          <button className={buttonClass()} disabled={add.pending}>Add room</button>
          <Flash result={add.result} />
        </form>
      )}
      <p className="mt-3 text-xs text-muted">Out-of-service rooms are removed from sellable inventory automatically. Check-in marks rooms occupied; check-out marks them for cleaning.</p>
    </Card>
  );
}
