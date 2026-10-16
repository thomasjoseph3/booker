"use client";

import Link from "next/link";
import { useParams, usePathname } from "next/navigation";
import clsx from "clsx";

const NAV: [string, string, string][] = [
  ["", "Dashboard", "◧"],
  ["/bookings", "Bookings", "▤"],
  ["/assistant", "Assistant", "✦"],
  ["/calls", "Agent calls", "☏"],
  ["/tickets", "Tickets", "⚑"],
  ["/analytics", "Analytics", "▥"],
  ["/guests", "Guests", "☺"],
  ["/rooms", "Rooms & rates", "⌂"],
  ["/offers", "Offers", "%"],
  ["/inventory", "Availability", "▦"],
  ["/payments", "Payments", "₹"],
  ["/messages", "Messages", "✉"],
  ["/settings", "Settings", "⚙"],
];

export function SideNav() {
  const { hotelId } = useParams<{ hotelId: string }>();
  const pathname = usePathname();
  const base = `/h/${hotelId}`;
  const active = (path: string) => {
    const full = base + path;
    if (path === "") return pathname === base;
    if (path === "/bookings") return pathname.startsWith(full) && !pathname.startsWith(`${base}/bookings/new`);
    return pathname.startsWith(full);
  };
  return (
    <nav className="flex gap-1 overflow-x-auto p-2 lg:flex-col lg:p-3">
      {NAV.map(([path, label, icon]) => (
        <Link key={path} href={base + path}
          className={clsx(
            "flex shrink-0 items-center gap-2.5 whitespace-nowrap rounded-lg px-3 py-2 transition-colors",
            active(path) ? "bg-accent-soft font-medium text-accent" : "text-ink-2 hover:bg-panel-2",
          )}>
          <span className="w-4 text-center opacity-80">{icon}</span>{label}
        </Link>
      ))}
    </nav>
  );
}
