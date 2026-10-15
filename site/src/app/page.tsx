import { notFound } from "next/navigation";
import { getProperty } from "@/lib/api";
import { PropertyPage } from "@/components/property-page";

export async function generateMetadata() {
  const p = await getProperty(process.env.NEXT_PUBLIC_HOTEL_SLUG ?? "");
  return { title: p ? `${p.name} · Book your stay` : "Book your stay" };
}

export default async function Home() {
  const p = await getProperty(process.env.NEXT_PUBLIC_HOTEL_SLUG ?? "");
  if (!p) notFound();
  return <PropertyPage p={p} />;
}
