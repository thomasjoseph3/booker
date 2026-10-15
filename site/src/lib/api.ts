import "server-only";

export const API_URL = process.env.API_URL ?? "http://localhost:4000";

export type RoomType = {
  id: string; name: string; description?: string; bedType?: string; sizeSqft?: number; view?: string;
  maxAdults: number; maxChildren: number; amenities: string[]; images: string[]; fromPrice: number;
};
export type Property = {
  slug: string; name: string; propertyType: string; description?: string; starRating?: number;
  address?: { line1?: string; line2?: string; city?: string; state?: string; country?: string; mapsUrl?: string };
  contact?: { phone?: string; email?: string };
  currency: string; checkInTime: string; checkOutTime: string; amenities: string[];
  faqs: { question: string; answer: string }[]; roomTypes: RoomType[];
};

export async function getProperty(slug: string): Promise<Property | null> {
  try {
    const res = await fetch(new URL(`/api/public/hotels/${encodeURIComponent(slug)}`, API_URL), { next: { revalidate: 30 } });
    return res.ok ? ((await res.json()) as Property) : null;
  } catch {
    return null;
  }
}

export const money = (currency: string, n: number) =>
  new Intl.NumberFormat("en-IN", { style: "currency", currency, maximumFractionDigits: 0 }).format(n);
