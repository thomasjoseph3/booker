import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { config } from '../../config.js';
import { signToken } from '../../middleware/auth.js';
import { ApiError } from '../../utils/errors.js';

/**
 * Connects the staff assistant to the MCP server as the signed-in staff member. The login token is made for this one
 * conversation turn and lasts a few minutes, so the server checks the same access (this property, this role) as
 * everywhere else. Close the client when the answer is done.
 */
export async function connectStaffTools(hotel, user, { url = config.mcp.url } = {}) {
  const client = new Client({ name: 'hotel-staff-assistant', version: '1.0.0' });
  try {
    await client.connect(
      new StreamableHTTPClientTransport(new URL(`${url}/mcp/staff/${hotel._id}`), {
        requestInit: { headers: { authorization: `Bearer ${signToken(user, '5m')}` } },
      }),
    );
  } catch (e) {
    throw new ApiError(503, 'TOOLS_UNAVAILABLE', `The assistant's tools server (MCP) is not reachable: ${e.message}`);
  }
  return client;
}
