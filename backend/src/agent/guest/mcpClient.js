import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { config } from '../../config.js';
import { mintCallToken } from '../../mcp/callToken.js';

/**
 * Connects one live call to the MCP server. The call carries a signed token that names its hotel, call and caller and
 * runs a little past the longest call allowed; it is the only credential the voice agent has for the hotel's tools.
 * Close the client when the call ends.
 */
export async function connectCallTools({ hotel, callId, callerPhone, callerEmail }, { url = config.mcp.url } = {}) {
  const token = mintCallToken(
    { hotelId: hotel._id, callId, phone: callerPhone, email: callerEmail },
    (config.gemini.maxLiveMinutes + 5) * 60,
  );
  const client = new Client({ name: 'hotel-voice-agent', version: '1.0.0' });
  await client.connect(
    new StreamableHTTPClientTransport(new URL(`${url}/mcp/booking`), { requestInit: { headers: { authorization: `Bearer ${token}` } } }),
  );
  return client;
}
