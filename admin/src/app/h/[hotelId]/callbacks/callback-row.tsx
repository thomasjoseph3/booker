"use client";

import Link from "next/link";
import { updateCallback } from "@/lib/actions";
import type { Callback } from "@/lib/types";
import { dateTime } from "@/lib/format";
import { useAction } from "@/components/use-action";
import { Badge, buttonClass, inputClass } from "@/components/ui";

export function CallbackRow({ hotelId, cb, tz }: { hotelId: string; cb: Callback; tz: string }) {
  const { pending, result, run } = useAction();
  return (
    <li className="grid gap-3 px-4 py-3 lg:grid-cols-[1fr_320px]">
      <div>
        <div className="flex flex-wrap items-center gap-2">
          <Badge value={cb.priority} tone={cb.priority === "high" ? "bad" : "neutral"} />
          <Badge value={cb.status} />
          <span className="font-medium">{cb.name ?? "Unknown caller"}</span>
          <a href={`tel:${cb.phone}`} className="text-accent">{cb.phone}</a>
        </div>
        <p className="mt-1.5">{cb.reason}</p>
        <div className="mt-1 text-xs text-muted">
          {dateTime(cb.createdAt, tz)} · from {cb.createdBy ?? "agent"}
          {cb.booking && <> · booking <Link href={`/h/${hotelId}/bookings/${cb.booking.code}`} className="font-mono text-accent">{cb.booking.code}</Link></>}
          {cb.assignedTo && <> · assigned to {cb.assignedTo}</>}
        </div>
      </div>
      <form className="space-y-2" onSubmit={(e) => {
        e.preventDefault();
        const f = new FormData(e.currentTarget);
        run(() => updateCallback(hotelId, cb._id, { status: String(f.get("status")), notes: String(f.get("notes") ?? "") }));
      }}>
        <div className="flex gap-2">
          <select name="status" defaultValue={cb.status} className={inputClass}>
            <option value="open">Open</option><option value="in_progress">In progress</option><option value="done">Done</option>
          </select>
          <button className={buttonClass("primary")} disabled={pending}>Save</button>
        </div>
        <input name="notes" defaultValue={cb.notes ?? ""} placeholder="Outcome notes" className={inputClass} />
        {result && !result.ok && <p className="text-xs text-bad">{result.message}</p>}
      </form>
    </li>
  );
}
