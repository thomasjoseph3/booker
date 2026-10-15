import * as bookings from '../../modules/bookings/repository.js';
import * as calls from '../../modules/calls/repository.js';
import { z } from 'zod';
import { createModels } from '../shared/model.js';

/**
 * Everything that writes the CallLog for an AI call (shown in the admin under "Agent calls"):
 * open it, append transcript lines, and close it with an outcome and summary.
 */

// What the agent did decides the outcome; the first matching tool wins.
const OUTCOME_BY_TOOL = [
  ['create_booking', 'booked'],
  ['cancel_booking', 'cancelled'],
  ['modify_booking', 'modified'],
  ['request_human_callback', 'callback_requested'],
];

const SummarySchema = z.object({
  summary: z.string().describe('One or two sentences, in English'),
  intent: z.string().describe('Short label in English, e.g. new booking, cancellation, room enquiry'),
  sentiment: z.enum(['positive', 'neutral', 'negative']),
  language: z.string().describe('Main language the caller spoke: English, Malayalam, Hindi, ... or Mixed'),
});

/** Creates the call record when a call connects. */
export function openCallLog(hotel, { callId, callerPhone, note, greeting, channel, model }) {
  const now = new Date();
  const transcript = [{ role: 'system', text: note, at: now }];
  if (greeting) transcript.push({ role: 'agent', text: greeting, at: now });
  return calls.createCall({
    hotel: hotel._id,
    callId,
    direction: 'inbound',
    fromNumber: callerPhone || undefined,
    toNumber: hotel.phoneNumbers?.[0],
    startedAt: now,
    channel,
    model,
    transcript,
  });
}

/** Appends transcript lines: `[{ role: 'caller' | 'agent' | 'tool', text }]`. */
export function appendTranscript(hotelId, callId, entries) {
  const at = new Date();
  return calls.appendTranscript(
    hotelId,
    callId,
    entries.map((e) => ({ ...e, at })),
  );
}

/** Records a problem in the call log (visible in the admin) so failures can be diagnosed afterwards. */
export function logCallError(hotelId, callId, message, detail) {
  return appendTranscript(hotelId, callId, [{ role: 'system', text: `⚠ ${message}`, data: { error: message, ...detail } }]).catch(() => {});
}

/** Asks the model for a short summary, intent, sentiment and language. Returns {} if that is not possible. */
async function summarize(transcript, makeModels = () => createModels({ temperature: 0, maxOutputTokens: 400 })) {
  // Tool lines are included so the summary can only state what really happened (a booking exists only if create_booking succeeded).
  const text = transcript.map((t) => (t.role === 'tool' ? `[tool] ${t.text}` : `${t.role}: ${t.text}`)).join('\n');
  try {
    const models = makeModels();
    const structured = (model) => model.withStructuredOutput(SummarySchema);
    const model = structured(models.primary).withFallbacks(models.fallbacks.map(structured));
    const result = await model.invoke(
      'Summarise this hotel phone call. Write the summary and intent in English even if the call was in another language, and report the language the caller mainly spoke. The caller lines are machine transcribed, so stray words from other languages (Spanish, German, ...) are transcription mistakes: judge the language from the whole call and from how the agent replied, and use Mixed only when the caller really mixed languages. ' +
        'Only state what the transcript and the [tool] lines show: say a booking was made or a payment link sent only if a create_booking tool succeeded, and say what was still pending otherwise.' +
        `\n\n${text}`,
    );
    // snake_case like the rest of the data (the admin turns underscores into spaces for display)
    return {
      ...result,
      intent: result.intent
        .toLowerCase()
        .trim()
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^_|_$/g, ''),
    };
  } catch (e) {
    console.error(`[agent] call summary failed: ${e.message}`);
    return {};
  }
}

/**
 * Closes the call record: end time, duration, outcome, summary, and the bookings made during the call.
 * @returns {Promise<{callId: string, outcome?: string, summary?: string, durationSec: number}>}
 */
export async function finishCall(hotel, callId, session) {
  const call = await calls.findCallByCallId(hotel._id, callId);
  const spoke = call?.transcript?.some((t) => t.role === 'caller');
  const outcome = OUTCOME_BY_TOOL.find(([tool]) => session.tools.has(tool))?.[1] ?? (spoke ? 'inquiry' : 'abandoned');
  const patch = {
    endedAt: new Date(),
    durationSec: Math.round((Date.now() - session.startedAt) / 1000),
    outcome,
    ...(spoke ? await summarize(call.transcript) : {}),
  };

  const update = { $set: patch };
  if (session.bookingCodes.size) {
    update.$addToSet = { bookings: { $each: await bookings.idsForCodes(hotel._id, [...session.bookingCodes]) } };
  }
  const saved = await calls.updateCall(hotel._id, callId, update);
  return { callId, outcome: saved.outcome, summary: saved.summary, durationSec: saved.durationSec };
}
