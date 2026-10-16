import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { requestAgentApi } from './agentApi.js';
import { guestToolSpecs } from './tools/guest.js';
import { runStaffTool, staffToolSpecs } from './tools/staff.js';
import { applyCallContext } from './context.js';

/**
 * The MCP servers. The hotel's tools are written in tools/ and offered from here, and every caller reaches them only
 * through here: the live voice call, the staff assistant, and outside MCP clients (Claude Desktop, Claude Code, other
 * agents). A tool added to tools/guest.js or tools/staff.js shows up for all of them.
 *
 *   booking server  the receptionist's tools (rooms, prices, bookings). Works through the /api/agent endpoints, so the
 *                   hotel scope, validation and permissions are the API's. A live call is signed in with its call token
 *                   (hotel, call and caller come from the token); an outside client uses a hotel's agent key.
 *   staff server    the read-only questions the staff assistant answers (analytics, arrivals, rooms...), for one
 *                   property and one signed-in user.
 */

/** An MCP tool result: the data as JSON text, flagged as an error when the tool reported one. */
const asResult = (data) => ({ content: [{ type: 'text', text: JSON.stringify(data) }], ...(data?.error ? { isError: true } : {}) });

/** Registers a tool; `audit` hears about every call (name, whether it worked, how long it took) but never its arguments. */
const register = (server, spec, run, audit) =>
  server.registerTool(spec.name, { description: spec.description, inputSchema: spec.schema.shape }, async (args) => {
    const started = Date.now();
    const result = await run(args);
    audit?.({ tool: spec.name, ok: !result?.error, ms: Date.now() - started });
    return asResult(result);
  });

/**
 * The receptionist's tools. `headers` carry the credentials to the agent API (x-api-key, x-hotel-id, x-call-id).
 * With `claims` (a live call) the call context is applied to every tool's arguments first.
 */
export function createBookingServer({ headers, baseUrl, claims, fetchImpl, audit }) {
  const server = new McpServer({ name: 'hotel-booking', version: '1.0.0' });
  for (const spec of guestToolSpecs) {
    register(
      server,
      spec,
      (args) => requestAgentApi(spec, claims ? applyCallContext(spec, args, claims) : args, headers, fetchImpl, baseUrl),
      audit,
    );
  }
  return server;
}

/** The staff assistant's read-only tools for `ctx.hotel`, run as `ctx.user`. */
export function createStaffServer(ctx, { audit } = {}) {
  const server = new McpServer({ name: 'hotel-staff', version: '1.0.0' });
  for (const spec of staffToolSpecs) register(server, spec, (args) => runStaffTool(ctx, spec.name, args), audit);
  return server;
}
