"use client";

import { useState } from "react";
import clsx from "clsx";
import * as A from "@/lib/actions";
import type { Offer } from "@/lib/types";
import { day } from "@/lib/format";
import { useAction } from "@/components/use-action";
import { Flash } from "@/components/flash";
import { Badge, buttonClass, Card, Field, inputClass } from "@/components/ui";

type Type = { id: string; name: string };

/** The conditions in plain words, the same way the agent says them. */
function conditions(o: Offer, types: Type[]) {
  const p: string[] = [];
  if (o.minNights) p.push(`stay at least ${o.minNights} night${o.minNights === 1 ? "" : "s"}`);
  if (o.bookAheadDays) p.push(`book at least ${o.bookAheadDays} day${o.bookAheadDays === 1 ? "" : "s"} before check-in`);
  if (o.stayFrom || o.stayTo) p.push(o.stayFrom && o.stayTo ? `stay between ${day(o.stayFrom)} and ${day(o.stayTo)}` : o.stayFrom ? `stay from ${day(o.stayFrom)}` : `stay until ${day(o.stayTo)}`);
  if (o.bookUntil) p.push(`book by ${day(o.bookUntil)}`);
  const names = o.roomTypes.map((id) => types.find((t) => t.id === id)?.name).filter(Boolean);
  if (names.length) p.push(`only ${names.join(" or ")}`);
  return p.length ? p.join(" · ") : "No conditions: every stay gets it";
}

function OfferForm({ hotelId, offer, types, onDone }: { hotelId: string; offer: Offer | null; types: Type[]; onDone: () => void }) {
  const { pending, result, run } = useAction();
  const [chosen, setChosen] = useState<string[]>(offer?.roomTypes ?? []);
  return (
    <form className="space-y-4 border-t border-line bg-panel-2 p-4" onSubmit={(e) => {
      e.preventDefault();
      const f = new FormData(e.currentTarget);
      const text = (k: string) => String(f.get(k) ?? "").trim();
      const date = (k: string) => text(k) || null;
      run(() => A.saveOffer(hotelId, offer?._id ?? null, {
        name: text("name"), description: text("description") || undefined, percentOff: Number(f.get("percentOff")),
        minNights: Number(f.get("minNights") || 0), bookAheadDays: Number(f.get("bookAheadDays") || 0),
        stayFrom: date("stayFrom"), stayTo: date("stayTo"), bookUntil: date("bookUntil"), roomTypes: chosen, active: offer?.active ?? true,
      }), onDone);
    }}>
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Offer name" className="sm:col-span-2"><input name="name" required defaultValue={offer?.name} placeholder="e.g. Stay 3 nights, save 10%" className={inputClass} /></Field>
        <Field label="Discount (%)" hint="Off the room price, before tax"><input name="percentOff" type="number" min={1} max={90} step="any" required defaultValue={offer?.percentOff} className={inputClass} /></Field>
      </div>
      <p className="text-xs font-medium text-ink-2">Who gets it (leave blank for no condition)</p>
      <div className="grid gap-3 sm:grid-cols-4">
        <Field label="Minimum nights"><input name="minNights" type="number" min={0} defaultValue={offer?.minNights || ""} placeholder="any" className={inputClass} /></Field>
        <Field label="Book days ahead" hint="At least this many days before check-in"><input name="bookAheadDays" type="number" min={0} defaultValue={offer?.bookAheadDays || ""} placeholder="any" className={inputClass} /></Field>
        <Field label="Stay from"><input name="stayFrom" type="date" defaultValue={offer?.stayFrom ?? ""} className={inputClass} /></Field>
        <Field label="Stay until"><input name="stayTo" type="date" defaultValue={offer?.stayTo ?? ""} className={inputClass} /></Field>
        <Field label="Book by" hint="Last day the offer can be booked"><input name="bookUntil" type="date" defaultValue={offer?.bookUntil ?? ""} className={inputClass} /></Field>
      </div>
      <Field label="Room types" hint={chosen.length ? "Only the ticked rooms" : "None ticked: all rooms"}>
        <div className="flex flex-wrap gap-2">
          {types.map((t) => (
            <label key={t.id} className={clsx("flex cursor-pointer items-center gap-1.5 rounded-full border px-3 py-1 text-sm", chosen.includes(t.id) ? "border-accent bg-accent-soft text-accent" : "border-line")}>
              <input type="checkbox" className="sr-only" checked={chosen.includes(t.id)} onChange={() => setChosen((c) => (c.includes(t.id) ? c.filter((x) => x !== t.id) : [...c, t.id]))} />
              {t.name}
            </label>
          ))}
        </div>
      </Field>
      <Field label="Extra note for the agent (optional)"><input name="description" defaultValue={offer?.description} placeholder="e.g. Applies to the room charge only, not food" className={inputClass} /></Field>
      <div className="flex items-center gap-2">
        <button className={buttonClass("primary")} disabled={pending}>{offer ? "Save changes" : "Create offer"}</button>
        <button type="button" className={buttonClass()} onClick={onDone}>Cancel</button>
        <Flash result={result} />
      </div>
    </form>
  );
}

function OfferRow({ hotelId, offer, types, canManage }: { hotelId: string; offer: Offer; types: Type[]; canManage: boolean }) {
  const { pending, result, run } = useAction();
  const [editing, setEditing] = useState(false);
  return (
    <li className={clsx(!offer.active && "opacity-60")}>
      <div className="flex flex-wrap items-center gap-4 p-4">
        <div className="grid size-14 shrink-0 place-items-center rounded-xl bg-accent-soft text-lg font-semibold text-accent">{offer.percentOff}%</div>
        <div className="min-w-60 flex-1">
          <div className="flex items-center gap-2 font-semibold">{offer.name} <Badge value={offer.active ? "active" : "off"} tone={offer.active ? "ok" : "neutral"} /></div>
          <div className="text-ink-2">{conditions(offer, types)}</div>
          {offer.description && <div className="text-xs text-muted">{offer.description}</div>}
        </div>
        {canManage && (
          <div className="flex gap-2">
            <button className={buttonClass()} disabled={pending} onClick={() => run(() => A.saveOffer(hotelId, offer._id, { active: !offer.active }))}>{offer.active ? "Turn off" : "Turn on"}</button>
            <button className={buttonClass()} onClick={() => setEditing(!editing)}>Edit</button>
            <button className={buttonClass()} disabled={pending} onClick={() => { if (confirm(`Delete "${offer.name}"?`)) run(() => A.deleteOffer(hotelId, offer._id)); }}>Delete</button>
          </div>
        )}
      </div>
      {result && !result.ok && <p className="px-4 pb-3 text-sm text-bad">{result.message}</p>}
      {editing && <OfferForm hotelId={hotelId} offer={offer} types={types} onDone={() => setEditing(false)} />}
    </li>
  );
}

export function OffersClient({ hotelId, offers, types, canManage }: { hotelId: string; offers: Offer[]; types: Type[]; canManage: boolean }) {
  const [adding, setAdding] = useState(false);
  return (
    <div className="space-y-4">
      <Card pad={false} title="Your offers" actions={canManage && !adding ? <button className={buttonClass("primary")} onClick={() => setAdding(true)}>+ New offer</button> : undefined}>
        {offers.length === 0 && !adding && <p className="p-6 text-center text-muted">No offers yet. Create one, for example “Stay 3 nights, save 10%”.</p>}
        <ul className="divide-y divide-line">
          {offers.map((o) => <OfferRow key={o._id} hotelId={hotelId} offer={o} types={types} canManage={canManage} />)}
        </ul>
        {adding && <OfferForm hotelId={hotelId} offer={null} types={types} onDone={() => setAdding(false)} />}
      </Card>
      <p className="text-xs text-muted">
        Offers apply automatically. If a stay qualifies for more than one, the guest gets the biggest, not a sum. The discount comes off the room price before tax, and the advance is worked out on the lower total.
        The agent also tells guests when an offer is close (for example “stay one more night to get 10%”).
      </p>
    </div>
  );
}
