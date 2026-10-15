import * as bookings from '../modules/bookings/repository.js';
import * as calls from '../modules/calls/repository.js';
import { generateContent } from './gemini.js';

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

const SUMMARY_SCHEMA = {
  type: 'object',
  properties: {
    summary: { type: 'string', description: 'One or two sentences' },
    intent: { type: 'string', description: 'Short label, e.g. new booking, cancellation, room enquiry' },
    sentiment: { type: 'string', enum: ['positive', 'neutral', 'negative'] },
  },
  required: ['summary', 'intent', 'sentiment'],
};

/** Creates the call record when a call connects. */
export function openCallLog(hotel, { callId, callerPhone, note, greeting }) {
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
    transcript,
  });
}

/** Appends transcript lines: `[{ role: 'caller' | 'agent' | 'tool', text }]`. */
export function appendTranscript(hotelId, callId, entries) {
  const at = new Date();
  return calls.appendTranscript(hotelId, callId, entries.map((e) => ({ ...e, at })));
}

/** Asks Gemini for a short summary, intent and sentiment. Returns {} if that is not possible. */
async function summarize(transcript) {
  const text = transcript.filter((t) => t.role !== 'tool').map((t) => `${t.role}: ${t.text}`).join('\n');
  try {
    const data = await generateContent({
      contents: [{ role: 'user', parts: [{ text: `Summarise this hotel phone call.\n\n${text}` }] }],
      generationConfig: { responseMimeType: 'application/json', responseSchema: SUMMARY_SCHEMA },
    });
    const result = JSON.parse(data.candidates[0].content.parts[0].text);
    // snake_case like the rest of the data (the admin turns underscores into spaces for display)
    if (result.intent) result.intent = result.intent.toLowerCase().trim().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
    return result;
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
