"use client";

import { useState } from "react";
import clsx from "clsx";
import { CallDialog } from "./call-dialog";

export function CallButton({ slug, hotelName, variant = "primary", children }: { slug: string; hotelName: string; variant?: "primary" | "floating" | "ghost"; children?: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className={clsx(
          "inline-flex items-center justify-center gap-2 font-medium transition",
          variant === "primary" && "rounded-full bg-brand px-6 py-3 text-brand-ink hover:brightness-110",
          variant === "ghost" && "rounded-full border border-line bg-card px-6 py-3 text-ink hover:bg-brand-soft",
          variant === "floating" && "fixed bottom-5 right-5 z-40 rounded-full bg-brand px-5 py-3.5 text-brand-ink shadow-xl hover:brightness-110",
        )}
      >
        {children ?? <>📞 Call to book</>}
      </button>
      {open && <CallDialog slug={slug} hotelName={hotelName} onClose={() => setOpen(false)} />}
    </>
  );
}
