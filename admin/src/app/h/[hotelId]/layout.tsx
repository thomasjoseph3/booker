import { Suspense } from "react";
import { SideNav } from "@/components/side-nav";
import { TopBar } from "@/components/top-bar";
import { Skeleton } from "@/components/ui";

export default function HotelLayout({ children, params }: LayoutProps<"/h/[hotelId]">) {
  return (
    <div className="min-h-screen lg:grid lg:grid-cols-[220px_1fr]">
      <aside className="border-b border-line bg-panel lg:sticky lg:top-0 lg:h-screen lg:border-b-0 lg:border-r">
        <div className="hidden items-center gap-2 px-5 py-4 font-semibold lg:flex">
          <span className="grid size-7 place-items-center rounded-lg bg-accent text-accent-ink">🏨</span> Hotel admin
        </div>
        <Suspense fallback={<div className="space-y-2 p-3"><Skeleton className="h-6" /><Skeleton className="h-6" /><Skeleton className="h-6" /></div>}>
          <SideNav />
        </Suspense>
      </aside>
      <div className="min-w-0">
        <Suspense fallback={<div className="h-14 border-b border-line bg-panel" />}>
          <TopBar params={params} />
        </Suspense>
        <main className="mx-auto max-w-[1400px] p-4 md:p-6">{children}</main>
      </div>
    </div>
  );
}
