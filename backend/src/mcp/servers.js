import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { requestAgentApi } from '../agent/guest/http.js';
import { guestToolSpecs } from '../agent/guest/tools.js';
import { runStaffTool, staffToolSpecs } from '../agent/staff/tools.js';

/**
 * The MCP servers: the same tools the in-app agents use, offered to outside MCP clients (Claude Desktop, Claude Code,
 * other agents). The tool specs stay the single source of truth, so a tool added to guest/tools.js or staff/tools.js
 * shows up here too. The live voice call does not go through MCP.
 *
 *   booking server  the receptionist's tools (rooms, prices, bookings). Works through the /api/agent endpoints with the
 *                   caller's own agent key, so the hotel scope, validation and permissions are the API's.
 *   staff server    the read-only questions the staff assistant answers (analytics, arrivals, rooms...), for one
 *                   property and one signed-in user.
 */

/** An MCP tool result: the data as JSON text, flagged as an error when the tool reported one. */
const asResult = (data) => ({ content: [{ type: 'text', text: JSON.stringify(data) }], ...(data?.error ? { isError: true } : {}) });

const register = (server, { name, description, schema }, run) =>
  server.registerTool(name, { description, inputSchema: schema.shape }, async (args) => asResult(await run(args)));

/** The receptionist's tools. `headers` carry the caller's credentials to the agent API (x-api-key, x-hotel-id); `baseUrl` is this same server. */
export function createBookingServer({ headers, baseUrl, fetchImpl }) {
  const server = new McpServer({ name: 'hotel-booking', version: '1.0.0' });
  for (const spec of guestToolSpecs) register(server, spec, (args) => requestAgentApi(spec, args, headers, fetchImpl, baseUrl));
  return server;
}

/** The staff assistant's read-only tools for `ctx.hotel`, run as `ctx.user`. */
export function createStaffServer(ctx) {
  const server = new McpServer({ name: 'hotel-staff', version: '1.0.0' });
  for (const spec of staffToolSpecs) register(server, spec, (args) => runStaffTool(ctx, spec.name, args));
  return server;
}
