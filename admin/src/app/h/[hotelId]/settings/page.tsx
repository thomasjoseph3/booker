import { Suspense } from "react";
import { getHotel, getMe, isManager } from "@/lib/auth";
import { PageHeader, PageSkeleton } from "@/components/ui";
import { SettingsForm } from "./settings-form";

export const metadata = { title: "Settings" };

export default function SettingsPage({ params }: PageProps<"/h/[hotelId]/settings">) {
  return (
    <>
      <PageHeader title="Property settings" subtitle="Everything here is read live by the booking API and the phone agent" />
      <Suspense fallback={<PageSkeleton rows={10} />}>
        <Loader params={params} />
      </Suspense>
    </>
  );
}

async function Loader({ params }: { params: PageProps<"/h/[hotelId]/settings">["params"] }) {
  const { hotelId } = await params;
  const [hotel, me] = await Promise.all([getHotel(hotelId), getMe()]);
  return <SettingsForm hotel={hotel} canManage={isManager(me)} />;
}
