import { Suspense } from "react";
import { getHotel } from "@/lib/auth";
import { todayIso } from "@/lib/dates";
import { PageHeader, PageSkeleton } from "@/components/ui";
import { NewBookingForm } from "./new-booking-form";

export const metadata = { title: "New booking" };

export default function NewBookingPage({ params }: PageProps<"/h/[hotelId]/bookings/new">) {
  return (
    <>
      <PageHeader title="New booking" subtitle="For phone, walk-in, OTA or website reservations taken by staff" />
      <Suspense fallback={<PageSkeleton rows={4} />}>
        <Loader params={params} />
      </Suspense>
    </>
  );
}

async function Loader({ params }: { params: PageProps<"/h/[hotelId]/bookings/new">["params"] }) {
  const { hotelId } = await params;
  const hotel = await getHotel(hotelId);
  return <NewBookingForm hotelId={hotelId} hotelName={hotel.name} currency={hotel.currency} allowPayAtHotel={hotel.payment.allowPayAtHotel} holdMinutes={hotel.payment.holdMinutes} today={todayIso(hotel.timezone)} />;
}
