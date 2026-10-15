import { Suspense } from "react";
import { redirect } from "next/navigation";
import { getHotels } from "@/lib/auth";

// Sends the user to their first property.
export default function Home() {
  return (
    <Suspense fallback={<p className="p-8 text-muted">Loading…</p>}>
      <ToFirstHotel />
    </Suspense>
  );
}

async function ToFirstHotel() {
  const hotels = await getHotels();
  if (!hotels.length) return <p className="p-8">No properties are assigned to your account yet.</p>;
  redirect(`/h/${hotels[0]._id}`);
}
