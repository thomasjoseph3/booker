import { getHotels, getMe } from "@/lib/auth";
import { logout } from "@/app/login/actions";
import { label } from "@/lib/format";
import { HotelSwitcher } from "./hotel-switcher";

export async function TopBar({ params }: { params: Promise<{ hotelId: string }> }) {
  const [{ hotelId }, me, hotels] = await Promise.all([params, getMe(), getHotels()]);
  const current = hotels.find((h) => h._id === hotelId);
  return (
    <header className="sticky top-0 z-20 flex h-14 items-center gap-3 border-b border-line bg-panel/90 px-4 backdrop-blur md:px-6">
      <HotelSwitcher hotels={hotels.map((h) => ({ id: h._id, name: h.name, city: h.address?.city }))} current={hotelId} />
      {current && <span className="hidden text-xs text-muted md:inline">{label(current.propertyType)} · {current.address?.city}</span>}
      <div className="flex-1" />
      <div className="text-right leading-tight">
        <div className="font-medium">{me.name}</div>
        <div className="text-xs capitalize text-muted">{label(me.role)}</div>
      </div>
      <form action={logout}>
        <button className="rounded-lg border border-line px-2.5 py-1.5 text-xs text-ink-2 hover:bg-panel-2">Sign out</button>
      </form>
    </header>
  );
}
