import Link from "next/link";
import clsx from "clsx";
import type { ReactNode } from "react";
import { label } from "@/lib/format";

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
        {subtitle && <p className="mt-0.5 text-muted">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

export function Card({ title, actions, children, className, pad = true }: { title?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string; pad?: boolean }) {
  return (
    <section className={clsx("min-w-0 rounded-xl border border-line bg-panel", className)}>
      {(title || actions) && (
        <header className="flex items-center justify-between gap-2 border-b border-line px-4 py-3">
          <h2 className="font-semibold">{title}</h2>
          {actions}
        </header>
      )}
      <div className={clsx(pad && "p-4")}>{children}</div>
    </section>
  );
}

const TONES: Record<string, string> = {
  ok: "bg-ok-soft text-ok",
  warn: "bg-warn-soft text-warn",
  bad: "bg-bad-soft text-bad",
  info: "bg-info-soft text-info",
  neutral: "bg-panel-2 text-ink-2 border border-line",
};

const STATUS_TONE: Record<string, keyof typeof TONES> = {
  confirmed: "ok", paid: "ok", done: "ok", refunded: "ok", available: "ok", booked: "ok", positive: "ok", sent: "ok",
  pending_payment: "warn", created: "warn", open: "warn", refund_pending: "warn", cleaning: "warn", high: "bad", normal: "neutral", low: "neutral", callback_requested: "warn",
  cancelled: "bad", expired: "bad", no_show: "bad", failed: "bad", out_of_service: "bad", negative: "bad", abandoned: "neutral",
  checked_in: "info", in_progress: "info", occupied: "info", modified: "info", inquiry: "info",
};

const STATUS_TEXT: Record<string, string> = { pending_payment: "awaiting payment", expired: "expired (unpaid)" };

export function Badge({ value, tone }: { value?: string | null; tone?: keyof typeof TONES }) {
  if (!value) return null;
  const t = tone ?? STATUS_TONE[value] ?? "neutral";
  return (
    <span className={clsx("inline-flex items-center whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium capitalize", TONES[t])}>
      {STATUS_TEXT[value] ?? label(value)}
    </span>
  );
}

export function Stat({ label: l, value, hint, href }: { label: string; value: ReactNode; hint?: ReactNode; href?: string }) {
  const body = (
    <div className="h-full rounded-xl border border-line bg-panel p-4 transition-colors hover:border-accent/40">
      <div className="text-xs font-medium text-muted">{l}</div>
      <div className="tabular mt-1 text-2xl font-semibold tracking-tight">{value}</div>
      {hint && <div className="mt-0.5 text-xs text-muted">{hint}</div>}
    </div>
  );
  return href ? <Link href={href}>{body}</Link> : body;
}

export function Table({ head, children, empty }: { head: ReactNode; children: ReactNode; empty?: string }) {
  const hasRows = Array.isArray(children) ? children.length > 0 : Boolean(children);
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-left">
        <thead className="text-xs text-muted [&_th]:whitespace-nowrap [&_th]:border-b [&_th]:border-line [&_th]:px-3 [&_th]:py-2 [&_th]:font-medium">
          {head}
        </thead>
        <tbody className="[&_td]:border-b [&_td]:border-line [&_td]:px-3 [&_td]:py-2.5 [&_tr:last-child_td]:border-b-0">
          {hasRows ? children : (
            <tr><td colSpan={20} className="py-10 text-center text-muted">{empty ?? "Nothing here yet"}</td></tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

export const btn = {
  base: "inline-flex items-center justify-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50",
  primary: "border-accent bg-accent text-accent-ink hover:opacity-90",
  secondary: "border-line bg-panel text-ink hover:bg-panel-2",
  danger: "border-bad/30 bg-panel text-bad hover:bg-bad-soft",
};
export const buttonClass = (variant: "primary" | "secondary" | "danger" = "secondary", extra?: string) => clsx(btn.base, btn[variant], extra);

export const inputClass = "w-full rounded-lg border border-line bg-panel px-3 py-1.5 text-sm text-ink outline-none focus:border-accent";

export function Field({ label: l, children, hint, className }: { label: string; children: ReactNode; hint?: string; className?: string }) {
  return (
    <label className={clsx("block space-y-1", className)}>
      <span className="text-xs font-medium text-ink-2">{l}</span>
      {children}
      {hint && <span className="block text-xs text-muted">{hint}</span>}
    </label>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={clsx("animate-pulse rounded-lg bg-line/60", className)} />;
}

export function PageSkeleton({ tiles = 0, rows = 8 }: { tiles?: number; rows?: number }) {
  return (
    <div className="space-y-4">
      <Skeleton className="h-8 w-56" />
      {tiles > 0 && (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          {Array.from({ length: tiles }, (_, i) => <Skeleton key={i} className="h-24" />)}
        </div>
      )}
      <div className="space-y-2 rounded-xl border border-line bg-panel p-4">
        {Array.from({ length: rows }, (_, i) => <Skeleton key={i} className="h-7" />)}
      </div>
    </div>
  );
}

export function Pagination({ page, pages, total, href }: { page: number; pages: number; total: number; href: (p: number) => string }) {
  if (pages <= 1) return <p className="px-4 py-3 text-xs text-muted">{total} result{total === 1 ? "" : "s"}</p>;
  return (
    <div className="flex items-center justify-between px-4 py-3 text-xs text-muted">
      <span>{total} results · page {page} of {pages}</span>
      <div className="flex gap-2">
        {page > 1 && <Link className={buttonClass()} href={href(page - 1)}>← Previous</Link>}
        {page < pages && <Link className={buttonClass()} href={href(page + 1)}>Next →</Link>}
      </div>
    </div>
  );
}

/** Renders WhatsApp-style text (*bold*, line breaks, links). */
export function WhatsAppText({ text }: { text: string }) {
  return (
    <div className="whitespace-pre-wrap break-words">
      {text.split(/(\*[^*\n]+\*|https?:\/\/\S+)/g).map((part, i) =>
        part.startsWith("*") && part.endsWith("*") && part.length > 2 ? <strong key={i}>{part.slice(1, -1)}</strong>
          : /^https?:\/\//.test(part) ? <a key={i} href={part} target="_blank" rel="noreferrer" className="text-accent underline">{part}</a>
            : part,
      )}
    </div>
  );
}
