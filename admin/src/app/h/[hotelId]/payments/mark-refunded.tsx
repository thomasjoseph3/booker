"use client";

import { markRefunded } from "@/lib/actions";
import { useAction } from "@/components/use-action";
import { buttonClass } from "@/components/ui";

export function MarkRefunded({ hotelId, paymentId }: { hotelId: string; paymentId: string }) {
  const { pending, result, run } = useAction();
  return (
    <>
      <button className={buttonClass()} disabled={pending} onClick={() => run(() => markRefunded(hotelId, paymentId))}>Mark refunded</button>
      {result && !result.ok && <span className="ml-2 text-xs text-bad">{result.message}</span>}
    </>
  );
}
