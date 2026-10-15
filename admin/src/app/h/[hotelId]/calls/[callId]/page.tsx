import Link from "next/link";
import { Suspense } from "react";
import clsx from "clsx";
import { api } from "@/lib/api";
import { getHotel } from "@/lib/auth";
import { dateTime, day, duration, label, time } from "@/lib/format";
import type { CallLog } from "@/lib/types";
import { Badge, Card, PageHeader, PageSkeleton } from "@/components/ui";

export const metadata = { title: "Call" };

export default function CallPage(props: PageProps<"/h/[hotelId]/calls/[callId]">) {
  return (
    <Suspense fallback={<PageSkeleton rows={10} />}>
      <CallContent {...props} />
    </Suspense>
  );
}

async function CallContent({ params }: PageProps<"/h/[hotelId]/calls/[callId]">) {
  const { hotelId, callId } = await params;
  const [hotel, call] = await Promise.all([getHotel(hotelId), api<CallLog>(`/hotels/${hotelId}/calls/${callId}`)]);
  const tz = hotel.timezone;
  const guest = call.guest && typeof call.guest !== "string" ? call.guest : null;
  return (
    <>
      <PageHeader
        title={`Call from ${call.fromNumber ?? "unknown"}`}
        subtitle={`${dateTime(call.startedAt ?? call.createdAt, tz)} · ${duration(call.durationSec)}`}
        actions={<Link href={`/h/${hotelId}/calls`} className="text-sm text-accent">← All calls</Link>}
      />
      <div className="grid gap-4 xl:grid-cols-[1fr_340px]">
        <Card title="Transcript">
          {!call.transcript?.length ? <p className="text-muted">No transcript recorded.</p> : (
            <div className="space-y-2">
              {call.transcript.map((t, i) => {
                if (t.role === "tool") return <ToolLine key={i} entry={t} />;
                if (t.role === "system") {
                  const problem = t.text.startsWith("⚠");
                  return (
                    <div key={i} className={clsx("mx-auto max-w-[95%] rounded-md px-2 py-1 text-center text-[11px]", problem ? "bg-bad-soft font-medium text-bad" : "bg-panel-2 text-muted")}>
                      {t.text}{t.at && ` · ${time(t.at, tz)}`}
                    </div>
                  );
                }
                return (
                  <div key={i} className={clsx("flex", t.role === "agent" ? "justify-end" : "justify-start")}>
                    <div className={clsx("max-w-[85%] rounded-2xl px-3.5 py-2 sm:max-w-[80%]", t.role === "agent" ? "rounded-br-sm bg-accent-soft" : "rounded-bl-sm bg-panel-2")}>
                      <div className="mb-0.5 text-[11px] text-muted">{t.role === "agent" ? "Agent" : "Caller"}{t.at && ` · ${time(t.at, tz)}`}</div>
                      {t.text}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </Card>
        <div className="space-y-4">
          <Card title="Call details">
            <dl className="space-y-2">
              <div className="flex justify-between gap-2"><dt className="text-muted">Outcome</dt><dd><Badge value={call.outcome} /></dd></div>
              <div className="flex justify-between gap-2"><dt className="text-muted">Intent</dt><dd className="capitalize">{label(call.intent) || "—"}</dd></div>
              <div className="flex justify-between gap-2"><dt className="text-muted">Sentiment</dt><dd><Badge value={call.sentiment} /></dd></div>
              <div className="flex justify-between gap-2"><dt className="text-muted">Language</dt><dd>{call.language ?? "—"}</dd></div>
              <div className="flex justify-between gap-2"><dt className="text-muted">Dialed</dt><dd>{call.toNumber ?? "—"}</dd></div>
              <div className="flex justify-between gap-2"><dt className="text-muted">Channel</dt><dd>{label(call.channel) || "—"}</dd></div>
              <div className="flex justify-between gap-2"><dt className="text-muted">Model</dt><dd className="truncate font-mono text-xs">{call.model ?? "—"}</dd></div>
              <div className="flex justify-between gap-2"><dt className="text-muted">Call ID</dt><dd className="truncate font-mono text-xs">{call.callId}</dd></div>
            </dl>
            {call.summary && <p className="mt-3 rounded-lg bg-panel-2 p-3 text-ink-2">{call.summary}</p>}
            {call.recordingUrl && <audio controls src={call.recordingUrl} className="mt-3 w-full" />}
          </Card>
          {guest && (
            <Card title="Caller" actions={<Link href={`/h/${hotelId}/guests/${guest._id}`} className="text-xs text-accent">Profile →</Link>}>
              <div className="font-medium">{guest.name} {guest.vip && <Badge value="VIP" tone="info" />}</div>
              <div className="text-muted">{guest.phone}{guest.email && ` · ${guest.email}`}</div>
            </Card>
          )}
          <Card title="Bookings from this call" pad={false}>
            {call.bookings.length === 0 ? <p className="p-4 text-muted">None</p> : (
              <ul className="divide-y divide-line">
                {call.bookings.map((b) => (
                  <li key={b._id} className="flex items-center justify-between px-4 py-2.5">
                    <Link href={`/h/${hotelId}/bookings/${b.code}`} className="font-mono font-medium text-accent hover:underline">{b.code}</Link>
                    <span className="text-xs text-muted">{day(b.checkIn)}</span>
                    <Badge value={b.status} />
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      </div>
    </>
  );
}

/** A tool the agent used. Expand it to see exactly what it asked for and what came back (for debugging). */
function ToolLine({ entry }: { entry: NonNullable<CallLog["transcript"]>[number] }) {
  const data = entry.data as { args?: unknown; result?: string; ok?: boolean; error?: string } | undefined;
  const failed = data?.ok === false;
  return (
    <details className={clsx("mx-auto max-w-[95%] rounded-md px-2 py-1 text-[11px]", failed ? "bg-bad-soft text-bad" : "bg-panel-2 text-muted")}>
      <summary className="cursor-pointer select-none text-center font-mono">⚙ {entry.text}</summary>
      {data && (
        <div className="mt-2 space-y-1.5 overflow-x-auto text-left font-mono text-ink-2">
          <div><span className="text-muted">asked for:</span> {JSON.stringify(data.args)}</div>
          {data.error && <div className="text-bad">error: {data.error}</div>}
          {data.result && <div className="break-all"><span className="text-muted">returned:</span> {data.result}</div>}
        </div>
      )}
    </details>
  );
}
