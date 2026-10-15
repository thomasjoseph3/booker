export function money(n: number | undefined | null, currency = "INR") {
  return `${currency === "INR" ? "₹" : `${currency} `}${Number(n ?? 0).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
}

export function compactMoney(n: number, currency = "INR") {
  const sym = currency === "INR" ? "₹" : `${currency} `;
  if (n >= 1e7) return `${sym}${(n / 1e7).toFixed(2)} Cr`;
  if (n >= 1e5) return `${sym}${(n / 1e5).toFixed(2)} L`;
  return money(n, currency);
}

export function day(d: string | undefined | null) {
  if (!d) return "—";
  return new Date(`${d}T00:00:00Z`).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
}

export function shortDay(d: string) {
  return new Date(`${d}T00:00:00Z`).toLocaleDateString("en-IN", { day: "numeric", month: "short", timeZone: "UTC" });
}

export function weekday(d: string) {
  return new Date(`${d}T00:00:00Z`).toLocaleDateString("en-IN", { weekday: "short", timeZone: "UTC" });
}

export function dateTime(d: string | undefined | null, timeZone = "Asia/Kolkata") {
  if (!d) return "—";
  return new Date(d).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short", timeZone });
}

export function time(d: string | undefined | null, timeZone = "Asia/Kolkata") {
  if (!d) return "—";
  return new Date(d).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit", timeZone });
}

export function duration(sec?: number) {
  if (!sec) return "—";
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return m ? `${m}m ${String(s).padStart(2, "0")}s` : `${s}s`;
}

export const label = (s?: string | null) => (s ? s.replace(/_/g, " ") : "");

const SOURCES: Record<string, string> = { phone_agent: "Phone agent", ota: "OTA", admin: "Staff", walk_in: "Walk-in", website: "Website" };
export const sourceLabel = (s?: string | null) => (s ? SOURCES[s] ?? label(s) : "");

/** "8/10" — compact axis label for a YYYY-MM-DD day. */
export const axisDay = (d: string) => `${Number(d.slice(8, 10))}/${Number(d.slice(5, 7))}`;
