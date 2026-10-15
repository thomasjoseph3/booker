"use client";

import { useState } from "react";
import * as A from "@/lib/actions";
import type { Hotel } from "@/lib/types";
import { useAction } from "@/components/use-action";
import { Flash } from "@/components/flash";
import { buttonClass, Card, Field, inputClass } from "@/components/ui";

const lines = (s: FormDataEntryValue | null) => String(s ?? "").split("\n").map((x) => x.trim()).filter(Boolean);

export function SettingsForm({ hotel: h, canManage }: { hotel: Hotel; canManage: boolean }) {
  const save = useAction();
  const key = useAction();
  const [apiKey, setApiKey] = useState<string | null>(null);
  const [faqs, setFaqs] = useState(h.faqs.map((f) => ({ ...f })));

  return (
    <form className="space-y-4" onSubmit={(e) => {
      e.preventDefault();
      const f = new FormData(e.currentTarget);
      const s = (k: string) => String(f.get(k) ?? "");
      const n = (k: string) => Number(f.get(k));
      save.run(() => A.saveHotel(h._id, {
        name: s("name"), description: s("description"),
        contact: { phone: s("contact.phone"), email: s("contact.email"), website: s("contact.website") },
        address: { line1: s("address.line1"), line2: s("address.line2"), city: s("address.city"), state: s("address.state"), postalCode: s("address.postalCode"), country: s("address.country"), mapsUrl: s("address.mapsUrl") },
        checkInTime: s("checkInTime"), checkOutTime: s("checkOutTime"), taxPercent: n("taxPercent"),
        phoneNumbers: lines(f.get("phoneNumbers")), amenities: lines(f.get("amenities")),
        payment: { advanceMode: s("payment.advanceMode"), advancePercent: n("payment.advancePercent"), holdMinutes: n("payment.holdMinutes"), allowPayAtHotel: f.get("payment.allowPayAtHotel") === "on" },
        cancellation: { freeUntilHours: n("cancellation.freeUntilHours"), lateFeePercent: n("cancellation.lateFeePercent"), noShowFeePercent: n("cancellation.noShowFeePercent") },
        policies: { petsAllowed: f.get("policies.petsAllowed") === "on", smokingAllowed: f.get("policies.smokingAllowed") === "on", idRequired: s("policies.idRequired"), childPolicy: s("policies.childPolicy"), other: lines(f.get("policies.other")) },
        faqs: faqs.filter((q) => q.question.trim() && q.answer.trim()),
        agent: { greeting: s("agent.greeting"), language: s("agent.language"), instructions: s("agent.instructions") },
      }));
    }}>
      <fieldset disabled={!canManage} className="space-y-4">
        <Card title="Property">
          <div className="grid gap-3 md:grid-cols-2">
            <Field label="Name"><input name="name" defaultValue={h.name} className={inputClass} /></Field>
            <Field label="Front desk phone"><input name="contact.phone" defaultValue={h.contact?.phone} className={inputClass} /></Field>
            <Field label="Email"><input name="contact.email" defaultValue={h.contact?.email} className={inputClass} /></Field>
            <Field label="Website"><input name="contact.website" defaultValue={h.contact?.website} className={inputClass} /></Field>
            <Field label="Description" className="md:col-span-2"><textarea name="description" rows={2} defaultValue={h.description} className={inputClass} /></Field>
          </div>
        </Card>

        <Card title="Address (sent to guests with check-in details)">
          <div className="grid gap-3 md:grid-cols-3">
            <Field label="Line 1"><input name="address.line1" defaultValue={h.address?.line1} className={inputClass} /></Field>
            <Field label="Line 2"><input name="address.line2" defaultValue={h.address?.line2} className={inputClass} /></Field>
            <Field label="City"><input name="address.city" defaultValue={h.address?.city} className={inputClass} /></Field>
            <Field label="State"><input name="address.state" defaultValue={h.address?.state} className={inputClass} /></Field>
            <Field label="Postal code"><input name="address.postalCode" defaultValue={h.address?.postalCode} className={inputClass} /></Field>
            <Field label="Country"><input name="address.country" defaultValue={h.address?.country} className={inputClass} /></Field>
            <Field label="Google Maps link" className="md:col-span-3"><input name="address.mapsUrl" defaultValue={h.address?.mapsUrl} className={inputClass} /></Field>
          </div>
        </Card>

        <div className="grid gap-4 xl:grid-cols-2">
          <Card title="Stay rules & tax">
            <div className="grid grid-cols-3 gap-3">
              <Field label="Check-in from"><input name="checkInTime" type="time" defaultValue={h.checkInTime} className={inputClass} /></Field>
              <Field label="Check-out by"><input name="checkOutTime" type="time" defaultValue={h.checkOutTime} className={inputClass} /></Field>
              <Field label="Tax %"><input name="taxPercent" type="number" step="0.01" min={0} defaultValue={h.taxPercent} className={inputClass} /></Field>
            </div>
          </Card>

          <Card title="Advance payment & hold">
            <div className="grid grid-cols-2 gap-3">
              <Field label="Advance required">
                <select name="payment.advanceMode" defaultValue={h.payment.advanceMode} className={inputClass}>
                  <option value="percentage">Percentage of total</option><option value="first_night">First night</option><option value="full">Full amount</option><option value="none">None</option>
                </select>
              </Field>
              <Field label="Advance %"><input name="payment.advancePercent" type="number" min={0} max={100} defaultValue={h.payment.advancePercent} className={inputClass} /></Field>
              <Field label="Hold room for (minutes)" hint="Unpaid bookings are released after this"><input name="payment.holdMinutes" type="number" min={5} max={1440} defaultValue={h.payment.holdMinutes} className={inputClass} /></Field>
              <label className="flex items-center gap-2 pt-5"><input type="checkbox" name="payment.allowPayAtHotel" defaultChecked={h.payment.allowPayAtHotel} /> Allow pay at hotel</label>
            </div>
          </Card>

          <Card title="Cancellation policy">
            <div className="grid grid-cols-3 gap-3">
              <Field label="Free until (hours before)"><input name="cancellation.freeUntilHours" type="number" min={0} defaultValue={h.cancellation.freeUntilHours} className={inputClass} /></Field>
              <Field label="Late cancel fee %"><input name="cancellation.lateFeePercent" type="number" min={0} max={100} defaultValue={h.cancellation.lateFeePercent} className={inputClass} /></Field>
              <Field label="No-show fee %"><input name="cancellation.noShowFeePercent" type="number" min={0} max={100} defaultValue={h.cancellation.noShowFeePercent} className={inputClass} /></Field>
            </div>
          </Card>

          <Card title="House policies">
            <div className="space-y-3">
              <div className="flex gap-6">
                <label className="flex items-center gap-2"><input type="checkbox" name="policies.petsAllowed" defaultChecked={h.policies?.petsAllowed} /> Pets allowed</label>
                <label className="flex items-center gap-2"><input type="checkbox" name="policies.smokingAllowed" defaultChecked={h.policies?.smokingAllowed} /> Smoking allowed</label>
              </div>
              <Field label="ID requirement"><input name="policies.idRequired" defaultValue={h.policies?.idRequired} className={inputClass} /></Field>
              <Field label="Child policy"><input name="policies.childPolicy" defaultValue={h.policies?.childPolicy} className={inputClass} /></Field>
              <Field label="Other policies (one per line)"><textarea name="policies.other" rows={3} defaultValue={h.policies?.other?.join("\n")} className={inputClass} /></Field>
            </div>
          </Card>
        </div>

        <div className="grid gap-4 xl:grid-cols-2">
          <Card title="Amenities & phone lines">
            <div className="grid gap-3 md:grid-cols-2">
              <Field label="Amenities (one per line)"><textarea name="amenities" rows={7} defaultValue={h.amenities.join("\n")} className={inputClass} /></Field>
              <Field label="Booking phone numbers (one per line)" hint="Calls to these numbers are routed to this property"><textarea name="phoneNumbers" rows={7} defaultValue={h.phoneNumbers.join("\n")} className={inputClass} /></Field>
            </div>
          </Card>
          <Card title="Phone agent">
            <div className="space-y-3">
              <Field label="Greeting"><input name="agent.greeting" defaultValue={h.agent?.greeting} className={inputClass} /></Field>
              <Field label="Language"><input name="agent.language" defaultValue={h.agent?.language} className={inputClass} /></Field>
              <Field label="Extra instructions"><textarea name="agent.instructions" rows={3} defaultValue={h.agent?.instructions} className={inputClass} /></Field>
            </div>
          </Card>
        </div>

        <Card title="FAQs (answered from here)" actions={canManage && <button type="button" className={buttonClass()} onClick={() => setFaqs([...faqs, { question: "", answer: "" }])}>+ Add FAQ</button>}>
          <div className="space-y-3">
            {faqs.map((q, i) => (
              <div key={i} className="grid gap-2 md:grid-cols-[1fr_2fr_auto]">
                <input placeholder="Question" value={q.question} onChange={(e) => setFaqs(faqs.map((x, j) => (j === i ? { ...x, question: e.target.value } : x)))} className={inputClass} />
                <input placeholder="Answer" value={q.answer} onChange={(e) => setFaqs(faqs.map((x, j) => (j === i ? { ...x, answer: e.target.value } : x)))} className={inputClass} />
                <button type="button" className={buttonClass("danger")} onClick={() => setFaqs(faqs.filter((_, j) => j !== i))}>Remove</button>
              </div>
            ))}
          </div>
        </Card>
      </fieldset>

      {canManage ? (
        <div className="sticky bottom-0 -mx-4 flex items-center gap-3 border-t border-line bg-panel/95 px-4 py-3 backdrop-blur md:-mx-6 md:px-6">
          <button className={buttonClass("primary")} disabled={save.pending}>{save.pending ? "Saving…" : "Save settings"}</button>
          <Flash result={save.result} />
        </div>
      ) : <p className="text-muted">Only managers can change property settings.</p>}

      <Card title="API access for the phone agent">
        <p className="text-ink-2">Property ID <code className="rounded bg-panel-2 px-1.5 py-0.5 font-mono text-xs">{h._id}</code> · current key <code className="rounded bg-panel-2 px-1.5 py-0.5 font-mono text-xs">{h.agent?.apiKeyPreview ?? "none"}</code></p>
        {canManage && (
          <div className="mt-3 space-y-2">
            <button type="button" className={buttonClass()} disabled={key.pending} onClick={() => key.run(() => A.rotateAgentKey(h._id), (d) => setApiKey(d.apiKey))}>Generate new API key</button>
            {apiKey && (
              <div className="rounded-lg border border-warn/30 bg-warn-soft p-3 text-warn">
                Copy this key now — it won&apos;t be shown again. The previous key has stopped working.
                <code className="mt-2 block break-all rounded bg-panel px-2 py-1.5 font-mono text-xs text-ink">{apiKey}</code>
              </div>
            )}
          </div>
        )}
      </Card>
    </form>
  );
}
