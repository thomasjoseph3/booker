import clsx from "clsx";

export function Flash({ result }: { result: { ok: boolean; message?: string } | null }) {
  if (!result?.message) return null;
  return (
    <p role="status" className={clsx("rounded-lg px-3 py-2 text-sm", result.ok ? "bg-ok-soft text-ok" : "bg-bad-soft text-bad")}>
      {result.message}
    </p>
  );
}
