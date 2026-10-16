import { tool } from '@langchain/core/tools';
import { appendTranscript } from './callRecord.js';
import { endCallSpec, guestToolSpecs } from './tools.js';

const MAX_LOGGED_RESULT = 3000;

/**
 * Runs one tool through the MCP server and unpacks its answer. The server fills in who the caller is and which call
 * this is from the call token, so nothing about that is added here. Never throws: failures come back as `{ error }`.
 */
async function callMcp(client, spec, { session }, args) {
  try {
    const res = await client.callTool({ name: spec.name, arguments: args });
    const text = res.content?.find((c) => c.type === 'text')?.text ?? '';
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      data = { error: text || 'The tool returned nothing' };
    }
    if (res.isError && !data.error) data = { error: text };
    if (data.error) return data;
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
 * `client` is the call's MCP client (see mcpClient.js); `log` can be replaced (the tests do).
 */
export function buildGuestTools(ctx, { log = appendTranscript, client } = {}) {
  return [...guestToolSpecs, endCallSpec].map((spec) =>
    tool(
      async (args) => {
        const started = Date.now();
        const result =
          spec === endCallSpec
            ? { ok: true, note: 'The call ends now. Do not say anything more.' }
            : await callMcp(client, spec, ctx, args);
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
