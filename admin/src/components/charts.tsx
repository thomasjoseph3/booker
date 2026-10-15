"use client";

import { useState } from "react";

/**
 * Small, dependency-free bar charts. Thin bars with rounded data-ends anchored to the baseline,
 * a recessive grid, per-bar hover tooltips with generous hit targets, and a legend for 2+ series.
 */

type Series = { key: string; label: string; color: string };
type Datum = { label: string; sub?: string; values: Record<string, number>; tooltip?: string };

// Props must stay serializable: this is rendered from Server Components, so no function props.
export function BarChart({ data, series, height = 180, suffix = "", max: fixedMax, labelEvery = 1 }: {
  data: Datum[]; series: Series[]; height?: number; suffix?: string; max?: number; labelEvery?: number;
}) {
  const format = (v: number) => `${v.toLocaleString("en-IN")}${suffix}`;
  const [hover, setHover] = useState<number | null>(null);
  const totals = data.map((d) => series.reduce((s, x) => s + (d.values[x.key] || 0), 0));
  const max = fixedMax ?? Math.max(1, ...totals);
  const ticks = [0, 0.5, 1].map((t) => Math.round(max * t));
  return (
    <div>
      {series.length > 1 && (
        <div className="mb-3 flex flex-wrap gap-4 text-xs text-ink-2">
          {series.map((s) => (
            <span key={s.key} className="inline-flex items-center gap-1.5">
              <span className="size-2.5 rounded-sm" style={{ background: s.color }} />{s.label}
            </span>
          ))}
        </div>
      )}
      <div className="relative flex" style={{ height }}>
        <div className="tabular flex w-9 shrink-0 flex-col-reverse justify-between pr-2 text-right text-[10px] text-muted">
          {ticks.map((t, i) => <span key={i} className="leading-none">{format(t)}</span>)}
        </div>
        <div className="relative flex-1">
          {[0, 0.5, 1].map((t) => (
            <div key={t} className="absolute inset-x-0 border-t" style={{ bottom: `${t * 100}%`, borderColor: "var(--chart-grid)" }} />
          ))}
          <div className="absolute inset-0 flex items-end gap-[2px]">
            {data.map((d, i) => (
              <div key={i} className="relative flex h-full flex-1 cursor-default flex-col justify-end"
                onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
                <div className="mx-auto flex w-full max-w-7 flex-col-reverse gap-[2px]">
                  {series.map((s, si) => {
                    const v = d.values[s.key] || 0;
                    if (!v) return null;
                    const isTop = series.slice(si + 1).every((x) => !(d.values[x.key] || 0));
                    return (
                      <div key={s.key} style={{ height: `${(v / max) * height}px`, background: s.color, opacity: hover === null || hover === i ? 1 : 0.55 }}
                        className={isTop ? "rounded-t-[4px]" : ""} />
                    );
                  })}
                </div>
                {hover === i && (
                  <div className="pointer-events-none absolute bottom-full left-1/2 z-10 mb-1 -translate-x-1/2 whitespace-nowrap rounded-lg border border-line bg-panel px-2.5 py-1.5 text-xs shadow-lg">
                    <div className="font-medium">{d.tooltip ?? d.label}</div>
                    {series.map((s) => (
                      <div key={s.key} className="tabular flex items-center gap-1.5 text-ink-2">
                        {series.length > 1 && <span className="size-2 rounded-sm" style={{ background: s.color }} />}
                        {s.label}: <span className="font-medium text-ink">{format(d.values[s.key] || 0)}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>
      <div className="ml-9 mt-1 flex gap-[2px] text-[10px] text-muted">
        {data.map((d, i) => (
          <div key={i} className="flex-1 truncate text-center">
            {i % labelEvery === 0 ? <>{d.label}{d.sub && <div>{d.sub}</div>}</> : " "}
          </div>
        ))}
      </div>
    </div>
  );
}

/** Horizontal magnitude bars for categories; labels and values are text, the bar carries the size. */
export function HBars({ rows, suffix = "", color = "var(--series-1)" }: {
  rows: { label: string; value: number; hint?: string }[]; suffix?: string; color?: string;
}) {
  const format = (v: number) => `${v.toLocaleString("en-IN")}${suffix}`;
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <div className="space-y-2.5">
      {rows.map((r, i) => (
        <div key={`${r.label}-${i}`} title={r.hint}>
          <div className="mb-1 flex justify-between gap-2 text-xs">
            <span className="capitalize text-ink-2">{r.label}</span>
            <span className="tabular font-medium">{format(r.value)}</span>
          </div>
          <div className="h-2 rounded-full bg-panel-2">
            <div className="h-2 rounded-full" style={{ width: `${(r.value / max) * 100}%`, background: color }} />
          </div>
        </div>
      ))}
    </div>
  );
}

/** One 100% bar split into parts, with a legend; used for small part-to-whole breakdowns. */
export function SplitBar({ parts }: { parts: { label: string; value: number; color: string }[] }) {
  const total = parts.reduce((s, p) => s + p.value, 0) || 1;
  return (
    <div>
      <div className="flex h-3 gap-[2px] overflow-hidden rounded-full">
        {parts.filter((p) => p.value).map((p, i) => (
          <div key={`${p.label}-${i}`} title={`${p.label}: ${p.value}`} style={{ width: `${(p.value / total) * 100}%`, background: p.color }} />
        ))}
      </div>
      <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-xs text-ink-2">
        {parts.map((p, i) => (
          <span key={`${p.label}-${i}`} className="inline-flex items-center gap-1.5">
            <span className="size-2.5 rounded-sm" style={{ background: p.color }} />
            <span className="capitalize">{p.label}</span>
            <span className="tabular font-medium text-ink">{p.value} ({Math.round((p.value / total) * 100)}%)</span>
          </span>
        ))}
      </div>
    </div>
  );
}
