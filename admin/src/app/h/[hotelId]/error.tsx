"use client";

import { buttonClass } from "@/components/ui";

export default function HotelError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return (
    <div className="mx-auto max-w-lg rounded-xl border border-line bg-panel p-6 text-center">
      <h2 className="text-lg font-semibold">Couldn&apos;t load this page</h2>
      <p className="mt-2 text-muted">{error.message || "Unexpected error"}</p>
      <button className={buttonClass("primary", "mt-4")} onClick={() => retry()}>Try again</button>
    </div>
  );
}
