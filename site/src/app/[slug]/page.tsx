import { notFound } from "next/navigation";
import { getProperty } from "@/lib/api";
import { PropertyPage } from "@/components/property-page";

export async function generateMetadata(props: PageProps<"/[slug]">) {
  const p = await getProperty((await props.params).slug);
  return { title: p ? `${p.name} · Book your stay` : "Not found" };
}

export default async function HotelPage(props: PageProps<"/[slug]">) {
  const p = await getProperty((await props.params).slug);
  if (!p) notFound();
  return <PropertyPage p={p} />;
}
