"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { inputClass } from "@/components/ui";

export function TypeFilter({ value, options }: { value: string; options: string[][] }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  return (
    <select aria-label="Ticket type" value={value} className={`${inputClass} w-52`}
      onChange={(e) => {
        const next = new URLSearchParams(params);
        next.set("type", e.target.value);
        next.set("page", "1");
        router.push(`${pathname}?${next}`);
      }}>
      <option value="">All types</option>
      {options.map(([k, t]) => <option key={k} value={k}>{t}</option>)}
    </select>
  );
}
