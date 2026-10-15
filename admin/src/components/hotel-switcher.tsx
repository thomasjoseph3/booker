"use client";

import { usePathname, useRouter } from "next/navigation";

export function HotelSwitcher({ hotels, current }: { hotels: { id: string; name: string; city?: string }[]; current: string }) {
  const router = useRouter();
  const pathname = usePathname();
  if (hotels.length <= 1) return <span className="font-semibold">{hotels[0]?.name}</span>;
  return (
    <select
      aria-label="Property"
      value={current}
      onChange={(e) => {
        // keep the same section when switching property, but drop record-specific paths
        const section = pathname.split("/")[3];
        router.push(`/h/${e.target.value}${section && section !== "bookings" ? `/${section}` : section ? "/bookings" : ""}`);
      }}
      className="max-w-[60vw] rounded-lg border border-line bg-panel px-2 py-1.5 font-semibold outline-none focus:border-accent"
    >
      {hotels.map((h) => <option key={h.id} value={h.id}>{h.name}</option>)}
    </select>
  );
}
