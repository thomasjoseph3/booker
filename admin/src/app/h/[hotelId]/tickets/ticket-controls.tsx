"use client";

import { useState } from "react";
import { updateTicket } from "@/lib/actions";
import { useAction } from "@/components/use-action";
import { buttonClass, inputClass } from "@/components/ui";

export function TicketControls({ hotelId, ticket }: { hotelId: string; ticket: { _id: string; status: string; priority: string; notes: string } }) {
  const { pending, result, run } = useAction();
  const [note, setNote] = useState(ticket.notes);
  const save = (body: Parameters<typeof updateTicket>[2]) => run(() => updateTicket(hotelId, ticket._id, body));
  return (
    <div className="flex flex-wrap items-center gap-2 border-t border-line pt-3">
      {ticket.status === "open" && <button className={buttonClass()} disabled={pending} onClick={() => save({ status: "in_progress" })}>Start working</button>}
      {ticket.status !== "done" && <button className={buttonClass("primary")} disabled={pending} onClick={() => save({ status: "done" })}>Mark done</button>}
      {ticket.status === "done" && <button className={buttonClass()} disabled={pending} onClick={() => save({ status: "open" })}>Reopen</button>}
      <select aria-label="Priority" defaultValue={ticket.priority} disabled={pending} className={`${inputClass} w-28`} onChange={(e) => save({ priority: e.target.value })}>
        <option value="high">Urgent</option><option value="normal">Normal</option><option value="low">Low</option>
      </select>
      <input aria-label="Note" value={note} onChange={(e) => setNote(e.target.value)} disabled={pending} placeholder="Add a note…" className={`${inputClass} min-w-48 flex-1`}
        onKeyDown={(e) => { if (e.key === "Enter") save({ notes: note }); }} />
      {note !== ticket.notes && <button className={buttonClass()} disabled={pending} onClick={() => save({ notes: note })}>Save note</button>}
      {result && !result.ok && <span className="text-xs text-bad">{result.message}</span>}
    </div>
  );
}
