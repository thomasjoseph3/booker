import { config } from '../../config.js';
import { toolByName } from './tools.js';

/**
 * Executes one tool call by calling the agent's own HTTP API (the same endpoints an external agent runtime
 * would use, so validation, tenant scoping and response shaping live in one place).
 * Never throws: failures come back as `{ error }` so the model can recover in conversation.
 */
export async function runTool(session, hotel, callId, name, args) {
  const tool = toolByName[name];
  if (!tool) return { error: `Unknown tool ${name}` };
  const input = { ...args };
  if (input.phone === undefined && session.callerPhone && tool.function.parameters.properties.phone) input.phone = session.callerPhone;
  if (name === 'create_booking') {
    input.callId = callId;
    input.guest = {
      ...(session.callerPhone ? { phone: session.callerPhone } : {}),
      ...(session.callerEmail ? { email: session.callerEmail } : {}),
      ...input.guest,
    };
  }
  if (name === 'request_human_callback') input.callId = callId;

  const { method, path } = tool.http;
  const url = new URL(
    path.replace(/\{(\w+)\}/g, (_, k) => encodeURIComponent(input[k] ?? '')),
    `http://127.0.0.1:${config.port}`,
  );
  const asQuery = method === 'GET';
  if (asQuery) for (const [k, v] of Object.entries(input)) if (v !== undefined && v !== '') url.searchParams.set(k, String(v));
  try {
    const res = await fetch(url, {
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
    session.tools.add(name);
    const code = data?.booking?.code;
    if (code) session.bookingCodes.add(code);
    return data;
  } catch (e) {
    return { error: e.message };
  }
}
