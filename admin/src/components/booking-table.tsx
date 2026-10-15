import Link from "next/link";
import type { Booking } from "@/lib/types";
import { day, money, shortDay, sourceLabel } from "@/lib/format";
import { Badge, Table } from "./ui";

export function BookingTable({ hotelId, items, empty, compact = false }: { hotelId: string; items: Booking[]; empty?: string; compact?: boolean }) {
  return (
    <Table
      empty={empty ?? "No bookings"}
      head={
        <tr>
          <th>Booking</th><th>Guest</th><th>Room</th><th>Stay</th><th>Status</th>
          {!compact && <th>Source</th>}
          <th className="text-right">Total</th>
          {!compact && <th className="text-right">Balance</th>}
        </tr>
      }
    >
      {items.map((b) => (
        <tr key={b._id} className="hover:bg-panel-2">
          <td><Link href={`/h/${hotelId}/bookings/${b.code}`} className="font-mono font-medium text-accent hover:underline">{b.code}</Link></td>
          <td className="whitespace-nowrap">
            <div className="font-medium">{b.guestName}</div>
            <div className="text-xs text-muted">{b.guestPhone}</div>
          </td>
          <td className="whitespace-nowrap">{b.roomsCount > 1 && `${b.roomsCount} × `}{b.roomTypeName}</td>
          <td className="whitespace-nowrap">{compact ? `${shortDay(b.checkIn)} → ${shortDay(b.checkOut)}` : `${day(b.checkIn)} → ${day(b.checkOut)}`}<div className="text-xs text-muted">{b.nights} night{b.nights > 1 ? "s" : ""} · {b.adults}A{b.children ? ` ${b.children}C` : ""}</div></td>
          <td><Badge value={b.status} /></td>
          {!compact && <td className="whitespace-nowrap text-ink-2">{sourceLabel(b.source)}</td>}
          <td className="tabular whitespace-nowrap text-right">{money(b.total, b.currency)}</td>
          {!compact && <td className="tabular whitespace-nowrap text-right">{b.balanceDue > 0 ? money(b.balanceDue, b.currency) : <span className="text-muted">—</span>}</td>}
        </tr>
      ))}
    </Table>
  );
}
