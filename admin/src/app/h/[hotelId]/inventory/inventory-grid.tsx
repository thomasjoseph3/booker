"use client";

import clsx from "clsx";
import { setStopSell } from "@/lib/actions";
import { shortDay, weekday } from "@/lib/format";
import { useAction } from "@/components/use-action";
import { Flash } from "@/components/flash";
import { Card } from "@/components/ui";

export type InventoryData = {
  dates: string[];
  roomTypes: { roomTypeId: string; name: string; totalRooms: number; days: { date: string; booked: number; available: number; closed: boolean }[] }[];
};

export function InventoryGrid({ hotelId, data, canManage }: { hotelId: string; data: InventoryData; canManage: boolean }) {
  const { pending, result, run } = useAction();
  return (
    <Card pad={false}>
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-center">
          <thead>
            <tr className="text-[11px] text-muted">
              <th className="sticky left-0 z-10 bg-panel px-3 py-2 text-left font-medium">Room type</th>
              {data.dates.map((d) => {
                const we = ["Fri", "Sat"].includes(weekday(d));
                return <th key={d} className={clsx("min-w-12 px-1 py-2 font-medium", we && "bg-panel-2")}><div>{weekday(d)}</div><div className="text-ink">{shortDay(d)}</div></th>;
              })}
            </tr>
          </thead>
          <tbody>
            {data.roomTypes.map((rt) => (
              <tr key={rt.roomTypeId} className="border-t border-line">
                <td className="sticky left-0 z-10 bg-panel px-3 py-2 text-left"><div className="font-medium">{rt.name}</div><div className="text-xs text-muted">{rt.totalRooms} rooms</div></td>
                {rt.days.map((c) => (
                  <td key={c.date} className="p-1">
                    <button
                      disabled={!canManage || pending}
                      onClick={() => run(() => setStopSell(hotelId, { roomTypeId: rt.roomTypeId, from: c.date, to: c.date, closed: !c.closed }))}
                      title={`${c.booked} booked · ${c.available} left${c.closed ? " · closed for sale" : ""}${canManage ? ` — click to ${c.closed ? "open" : "close"}` : ""}`}
                      className={clsx(
                        "tabular h-10 w-full rounded-md text-sm font-medium transition-colors disabled:cursor-default",
                        c.closed ? "bg-bad-soft text-bad line-through" : c.available === 0 ? "bg-warn-soft text-warn" : c.available <= Math.ceil(rt.totalRooms * 0.25) ? "bg-accent-soft text-accent" : "bg-ok-soft text-ok",
                        canManage && "hover:ring-2 hover:ring-accent/40",
                      )}
                    >
                      {c.closed ? "✕" : c.available}
                    </button>
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex flex-wrap items-center gap-4 border-t border-line px-4 py-3 text-xs text-ink-2">
        <span className="inline-flex items-center gap-1.5"><span className="size-3 rounded bg-ok-soft ring-1 ring-ok/30" /> Plenty left</span>
        <span className="inline-flex items-center gap-1.5"><span className="size-3 rounded bg-accent-soft ring-1 ring-accent/30" /> Few left</span>
        <span className="inline-flex items-center gap-1.5"><span className="size-3 rounded bg-warn-soft ring-1 ring-warn/30" /> Sold out</span>
        <span className="inline-flex items-center gap-1.5"><span className="size-3 rounded bg-bad-soft ring-1 ring-bad/30" /> Closed (stop-sell)</span>
        <div className="flex-1" />
        <Flash result={result && !result.ok ? result : null} />
      </div>
    </Card>
  );
}
