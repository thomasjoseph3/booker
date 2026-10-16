import { Suspense } from "react";
import { api } from "@/lib/api";
import { getMe, isManager } from "@/lib/auth";
import type { Offer, RoomType } from "@/lib/types";
import { PageHeader, PageSkeleton } from "@/components/ui";
import { OffersClient } from "./offers-client";

export const metadata = { title: "Offers" };

export default function OffersPage(props: PageProps<"/h/[hotelId]/offers">) {
  return (
    <>
      <PageHeader title="Offers" subtitle="Discounts that apply by themselves when a stay meets the conditions. The AI agent and the website quote them." />
      <Suspense fallback={<PageSkeleton rows={4} />}>
        <OffersContent {...props} />
      </Suspense>
    </>
  );
}

async function OffersContent({ params }: PageProps<"/h/[hotelId]/offers">) {
  const { hotelId } = await params;
  const [offers, types, me] = await Promise.all([
    api<{ items: Offer[] }>(`/hotels/${hotelId}/offers`),
    api<{ items: RoomType[] }>(`/hotels/${hotelId}/room-types`),
    getMe(),
  ]);
  return <OffersClient hotelId={hotelId} offers={offers.items} types={types.items.filter((t) => t.active).map((t) => ({ id: t._id, name: t.name }))} canManage={isManager(me)} />;
}
