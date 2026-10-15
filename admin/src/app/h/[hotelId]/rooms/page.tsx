import { Suspense } from "react";
import { api } from "@/lib/api";
import { getHotel, getMe, isManager } from "@/lib/auth";
import { todayIso } from "@/lib/dates";
import type { Room, RoomType } from "@/lib/types";
import { PageHeader, PageSkeleton } from "@/components/ui";
import { RoomTypesEditor, RoomsBoard } from "./rooms-client";

export const metadata = { title: "Rooms & rates" };

export default function RoomsPage({ params }: PageProps<"/h/[hotelId]/rooms">) {
  return (
    <>
      <PageHeader title="Rooms & rates" subtitle="Who is in each room right now, housekeeping status, room types and prices" />
      <Suspense fallback={<PageSkeleton rows={10} />}>
        <RoomsContent params={params} />
      </Suspense>
    </>
  );
}

async function RoomsContent({ params }: { params: PageProps<"/h/[hotelId]/rooms">["params"] }) {
  const { hotelId } = await params;
  const [hotel, me, types, rooms] = await Promise.all([
    getHotel(hotelId), getMe(),
    api<{ items: RoomType[] }>(`/hotels/${hotelId}/room-types`),
    api<{ items: Room[] }>(`/hotels/${hotelId}/rooms`),
  ]);
  return (
    <div className="space-y-4">
      <RoomsBoard hotelId={hotelId} rooms={rooms.items} types={types.items.filter((t) => t.active).map((t) => ({ id: t._id, name: t.name }))} canManage={isManager(me)} tz={hotel.timezone} today={todayIso(hotel.timezone)} />
      <RoomTypesEditor hotelId={hotelId} types={types.items} currency={hotel.currency} canManage={isManager(me)} />
    </div>
  );
}
