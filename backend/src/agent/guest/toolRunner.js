import { tool } from '@langchain/core/tools';
import { config } from '../../config.js';
import { appendTranscript } from './callRecord.js';
import { guestToolSpecs } from './tools.js';

const MAX_LOGGED_RESULT = 3000;

/**
 * Calls the agent's own HTTP API (the same endpoints an external agent runtime would use, so validation, tenant
 * scoping and response shaping live in one place). The caller's phone number and email are filled in when the
 * model leaves them out. Never throws: failures come back as `{ error }`.
 */
async function callAgentApi(spec, { session, hotel, callId }, args, fetchImpl) {
  const input = { ...args };
  if (input.phone === undefined && session.callerPhone && 'phone' in spec.schema.shape) input.phone = session.callerPhone;
  if (spec.name === 'create_booking') {
    input.callId = callId;
    input.guest = {
      ...(session.callerPhone ? { phone: session.callerPhone } : {}),
      ...(session.callerEmail ? { email: session.callerEmail } : {}),
      ...input.guest,
    };
  }
  if (spec.name === 'request_human_callback') input.callId = callId;

  const { method, path } = spec.http;
  const url = new URL(
    path.replace(/\{(\w+)\}/g, (_, k) => encodeURIComponent(input[k] ?? '')),
    `http://127.0.0.1:${config.port}`,
  );
  const asQuery = method === 'GET';
  if (asQuery) for (const [k, v] of Object.entries(input)) if (v !== undefined && v !== '') url.searchParams.set(k, String(v));
  try {
    const res = await fetchImpl(url, {
      method,
      headers: {
        'x-api-key': config.internalAgentKey,
        'x-hotel-id': String(hotel._id),
        'x-call-id': callId,
        ...(asQuery ? {} : { 'content-type': 'application/json' }),
      },
      body: asQuery ? undefined : JSON.stringify(input),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return { error: data?.error?.message || `Request failed (${res.status})`, details: data?.error?.details };
    session.tools.add(spec.name);
    const bookingCode = data?.booking?.code;
    if (bookingCode) session.bookingCodes.add(bookingCode);
    return data;
  } catch (e) {
    return { error: e.message };
  }
}

/**
 * LangChain tools for one call, bound to the caller's session. Every call is recorded in the call log with its
 * arguments, result, outcome and timing, so any call can be replayed and debugged later.
 * `log` and `fetch` can be replaced (the tests do).
 */
export function buildGuestTools(ctx, { log = appendTranscript, fetch: fetchImpl = globalThis.fetch } = {}) {
  return guestToolSpecs.map((spec) =>
    tool(
      async (args) => {
        const started = Date.now();
        const result = await callAgentApi(spec, ctx, args, fetchImpl);
        const ms = Date.now() - started;
        const text = JSON.stringify(result);
        await log(ctx.hotel._id, ctx.callId, [
          {
            role: 'tool',
            text: `${spec.name} → ${result.error ? `ERROR ${result.error}` : 'ok'} (${ms} ms)`,
            data: { name: spec.name, args, ok: !result.error, ms, error: result.error, result: text.slice(0, MAX_LOGGED_RESULT) },
          },
        ]);
        return text;
      },
      { name: spec.name, description: spec.description, schema: spec.schema },
    ),
  );
}

/** Runs a tool by name and returns its result as an object. Bad arguments or unknown tools come back as `{ error }`. */
export async function invokeGuestTool(tools, name, args) {
  const found = tools.find((t) => t.name === name);
  if (!found) return { error: `Unknown tool ${name}` };
  try {
    return JSON.parse(await found.invoke(args ?? {}));
  } catch (e) {
    return { error: e.message };
  }
}
