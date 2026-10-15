import crypto from 'node:crypto';
import { geminiFunctionDeclarations } from './tools.js';
import { appendTranscript, finishCall, openCallLog } from './callRecord.js';
import { generateContent } from '../shared/gemini.js';
import { buildSystemPrompt } from './prompt.js';
import { createSession } from './session.js';
import { runTool } from './toolRunner.js';
import { badRequest, notFound } from '../../utils/errors.js';
import { normalizePhone } from '../../utils/misc.js';

/**
 * Turn-based agent: text in, text out (Gemini function calling). Used by the admin "Talk to agent" tester,
 * where the browser does the speech-to-text and text-to-speech. The real-time audio agent is liveAgent.js.
 */

const MAX_TOOL_ROUNDS = 6;
const SESSION_TTL_MS = 2 * 60 * 60 * 1000;

/** callId -> session plus the Gemini conversation (`contents`) so tool results survive between turns. */
const sessions = new Map();

const defaultGreeting = (hotel) => hotel.agent?.greeting || `Hello, thank you for calling ${hotel.name}. How can I help you today?`;

function getSession(hotel, callId) {
  const session = sessions.get(callId);
  if (!session || String(session.hotelId) !== String(hotel._id)) throw notFound('Call (it may have ended)');
  return session;
}

/** Starts a call and returns the agent's greeting. */
export async function startCall(hotel, { callerPhone, callerEmail }) {
  const phone = normalizePhone(callerPhone || '');
  if (!phone) throw badRequest('A caller phone number is required');
  for (const [id, s] of sessions) if (Date.now() - s.startedAt > SESSION_TTL_MS) sessions.delete(id);

  const callId = `web-${crypto.randomBytes(5).toString('hex')}`;
  const greeting = defaultGreeting(hotel);
  sessions.set(callId, {
    ...createSession({ callerPhone: phone, callerEmail: callerEmail || undefined }),
    hotelId: hotel._id,
    busy: false,
    contents: [
      { role: 'user', parts: [{ text: '[The call has just connected.]' }] },
      { role: 'model', parts: [{ text: greeting }] },
    ],
  });
  await openCallLog(hotel, { callId, callerPhone: phone, note: 'Browser test call', greeting });
  return { callId, greeting };
}

/**
 * One caller turn: runs the model, executes any tool calls it makes (looping until it answers in words),
 * logs the exchange and returns the reply.
 */
export async function agentTurn(hotel, callId, text) {
  const session = getSession(hotel, callId);
  if (session.busy) throw badRequest('The agent is still answering the previous turn');
  session.busy = true;
  const used = [];
  try {
    session.contents.push({ role: 'user', parts: [{ text }] });
    const entries = [{ role: 'caller', text }];
    let reply = '';
    for (let round = 0; round <= MAX_TOOL_ROUNDS; round++) {
      const data = await generateContent({
        systemInstruction: { parts: [{ text: buildSystemPrompt(hotel, session) }] },
        contents: session.contents,
        tools: [{ functionDeclarations: geminiFunctionDeclarations }],
        generationConfig: { temperature: 0.4, maxOutputTokens: 600 },
      });
      const content = data.candidates?.[0]?.content;
      if (!content?.parts?.length) {
        reply = "Sorry, I didn't catch that. Could you say it again?";
        break;
      }
      session.contents.push(content); // keep verbatim (includes Gemini's thought signatures)
      const calls = content.parts.filter((p) => p.functionCall);
      if (!calls.length) {
        reply = content.parts
          .map((p) => p.text || '')
          .join('')
          .trim();
        break;
      }
      const responses = [];
      for (const { functionCall: call } of calls) {
        const result = await runTool(session, hotel, callId, call.name, call.args || {});
        used.push({ name: call.name, ok: !result.error });
        entries.push({
          role: 'tool',
          text: `${call.name}(${JSON.stringify(call.args || {})}) → ${result.error ? `ERROR ${result.error}` : 'ok'}`,
        });
        responses.push({ functionResponse: { name: call.name, response: { result } } });
      }
      session.contents.push({ role: 'user', parts: responses });
    }
    reply ||= 'Sorry, could you repeat that?';
    entries.push({ role: 'agent', text: reply });
    await appendTranscript(hotel._id, callId, entries);
    return { reply, tools: used };
  } finally {
    session.busy = false;
  }
}

/** Hangs up: closes the call record with outcome and summary. */
export async function endCall(hotel, callId) {
  const session = getSession(hotel, callId);
  sessions.delete(callId);
  return finishCall(hotel, callId, session);
}
