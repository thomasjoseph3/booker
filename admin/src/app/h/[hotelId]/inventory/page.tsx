import Link from "next/link";
import { Suspense } from "react";
import { api } from "@/lib/api";
import { getHotel, getMe, isManager } from "@/lib/auth";
import { todayIso, addDaysIso } from "@/lib/dates";
import { buttonClass, PageHeader, PageSkeleton } from "@/components/ui";
import { InventoryGrid, type InventoryData } from "./inventory-grid";

export const metadata = { title: "Availability" };
const SPAN = 21;

export default function InventoryPage(props: PageProps<"/h/[hotelId]/inventory">) {
  return (
    <>
      <PageHeader title="Availability" subtitle="Rooms left to sell each night. Close a night to stop the agent and staff from selling it." />
      <Suspense fallback={<PageSkeleton rows={6} />}>
        <InventoryContent {...props} />
      </Suspense>
    </>
  );
}

async function InventoryContent({ params, searchParams }: PageProps<"/h/[hotelId]/inventory">) {
  const [{ hotelId }, sp] = await Promise.all([params, searchParams]);
  const [hotel, me] = await Promise.all([getHotel(hotelId), getMe()]);
  const from = typeof sp.from === "string" && /^\d{4}-\d{2}-\d{2}$/.test(sp.from) ? sp.from : todayIso(hotel.timezone);
  const to = addDaysIso(from, SPAN - 1);
  const data = await api<InventoryData>(`/hotels/${hotelId}/inventory`, { query: { from, to } });
  const nav = (d: number) => `/h/${hotelId}/inventory?from=${addDaysIso(from, d)}`;
  return (
    <>
      <div className="mb-3 flex gap-2">
        <Link href={nav(-SPAN)} className={buttonClass()}>← Earlier</Link>
        <Link href={`/h/${hotelId}/inventory`} className={buttonClass()}>Today</Link>
        <Link href={nav(SPAN)} className={buttonClass()}>Later →</Link>
      </div>
      <InventoryGrid hotelId={hotelId} data={data} canManage={isManager(me)} />
    </>
  );
}
