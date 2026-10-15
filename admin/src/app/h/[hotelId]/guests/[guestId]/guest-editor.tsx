"use client";

import { updateGuest } from "@/lib/actions";
import { useAction } from "@/components/use-action";
import { Flash } from "@/components/flash";
import { buttonClass, Card, Field, inputClass } from "@/components/ui";

export function GuestEditor({ hotelId, guestId, vip, notes }: { hotelId: string; guestId: string; vip: boolean; notes: string }) {
  const { pending, result, run } = useAction();
  return (
    <Card title="Guest profile" className="h-fit">
      <form className="space-y-3" onSubmit={(e) => {
        e.preventDefault();
        const f = new FormData(e.currentTarget);
        run(() => updateGuest(hotelId, guestId, { vip: f.get("vip") === "on", notes: String(f.get("notes") ?? "") }));
      }}>
        <label className="flex items-center gap-2"><input type="checkbox" name="vip" defaultChecked={vip} /> VIP guest</label>
        <Field label="Notes (preferences, allergies…)"><textarea name="notes" rows={5} defaultValue={notes} className={inputClass} /></Field>
        <Flash result={result} />
        <button className={buttonClass("primary")} disabled={pending}>Save</button>
      </form>
    </Card>
  );
}
