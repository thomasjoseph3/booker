import { callMcpTool, toLangChainTools } from '../shared/mcpTools.js';
import { appendTranscript } from './callRecord.js';
import { endCallTool } from './callControl.js';

const MAX_LOGGED_RESULT = 3000;

/**
 * LangChain tools for one call, bound to the caller's session. The tool list comes from the MCP server (`mcpTools`),
 * and every tool runs there; the server fills in who the caller is and which call this is from the call token, so
 * nothing about that is added here. Only `end_call` (hanging up) is handled locally. Every call is recorded in the call
 * log with its arguments, result, outcome and timing, so any call can be replayed and debugged later.
 * `client` is the call's MCP client (see mcpClient.js); `log` can be replaced (the tests do).
 */
export function buildGuestTools(ctx, { log = appendTranscript, client, mcpTools = [] } = {}) {
  return toLangChainTools([...mcpTools, endCallTool], async (spec, args) => {
    const started = Date.now();
    const result =
      spec === endCallTool
        ? { ok: true, note: 'The call ends now. Do not say anything more.' }
        : await runOnServer(client, spec.name, ctx, args);
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
  });
}

/** Runs the tool on the MCP server and remembers what was done on this call (for classifying it when it ends). */
async function runOnServer(client, name, { session }, args) {
  const data = await callMcpTool(client, name, args);
  if (data.error) return data;
  session.tools.add(name);
  const bookingCode = data?.booking?.code;
  if (bookingCode) session.bookingCodes.add(bookingCode);
  return data;
}

/** Runs a tool by name and returns its result as an object. Unknown tools come back as `{ error }`. */
export async function invokeGuestTool(tools, name, args) {
  const found = tools.find((t) => t.name === name);
  if (!found) return { error: `Unknown tool ${name}` };
  try {
    return JSON.parse(await found.invoke(args ?? {}));
  } catch (e) {
    return { error: e.message };
  }
}
