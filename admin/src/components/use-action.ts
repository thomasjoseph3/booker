"use client";

import { useState, useTransition } from "react";
import type { ActionResult } from "@/lib/actions";

/** Runs a server action from an event handler and keeps a success/error message. */
export function useAction() {
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<{ ok: boolean; message?: string } | null>(null);
  function run<T>(fn: () => Promise<ActionResult<T>>, onSuccess?: (data: T) => void) {
    startTransition(async () => {
      const r = await fn();
      setResult({ ok: r.ok, message: r.message });
      if (r.ok) onSuccess?.(r.data);
    });
  }
  return { pending, result, run, clear: () => setResult(null) };
}
