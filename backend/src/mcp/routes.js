import { Router } from 'express';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { requireAgent, requireHotelContext } from '../agent/guest/auth.js';
import { config } from '../config.js';
import { requireAdmin, loadHotelParam } from '../middleware/auth.js';
import { rateLimit } from '../middleware/rateLimit.js';
import * as hotels from '../modules/hotels/repository.js';
import { unauthorized } from '../utils/errors.js';
import { verifyCallToken } from './callToken.js';
import { createBookingServer, createStaffServer } from './servers.js';

/**
 * MCP over HTTP (the "streamable HTTP" transport), stateless: every request gets its own server instance, so nothing
 * is kept between requests.
 *
 *   POST /mcp/booking            a live call:      Authorization: Bearer <call token>
 *                                an outside client: x-api-key: the hotel's agent key (master key + x-hotel-id also works)
 *   POST /mcp/staff/:hotelId     Authorization: Bearer <admin login token>
 */

// Each request can reach the database and the API, so cap how fast one caller can go.
const perCaller = rateLimit({ windowMs: 60 * 1000, max: 300, key: (req) => req.get('x-api-key') || req.get('authorization') || req.ip });

/** One line per tool call for the logs: who (hotel, call) did what and whether it worked. Never the arguments. */
const auditTo = (who) => (call) =>
  console.log(JSON.stringify({ at: new Date().toISOString(), mcp: who.server, hotel: who.hotel, call: who.call, ...call }));

/** Hands the request to a fresh MCP server through a one-shot transport. */
async function serve(req, res, server) {
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  res.on('close', () => {
    transport.close();
    server.close();
  });
  await server.connect(transport);
  await transport.handleRequest(req, res, req.body);
}

// Without sessions there is no stream to open or session to end, so only POST is allowed.
const notAllowed = (req, res) =>
  res
    .status(405)
    .set('Allow', 'POST')
    .json({ jsonrpc: '2.0', error: { code: -32000, message: 'Method not allowed' }, id: null });

/**
 * Signs the request in. A live call's token names its hotel, call and caller; the key the MCP server then uses with the
 * API is its own (AGENT_MASTER_KEY), so the voice agent never holds it. Anything else must be a hotel agent key.
 */
async function authenticateBooking(req, res, next) {
  const bearer = (req.get('authorization') || '').match(/^Bearer (.+)$/i)?.[1];
  if (!bearer) return requireAgent(req, res, () => requireHotelContext(req, res, next)); // an outside client's agent key
  let claims;
  try {
    claims = verifyCallToken(bearer);
  } catch {
    throw unauthorized('Invalid or expired call token');
  }
  if (!config.agentMasterKey) throw unauthorized('The MCP server has no AGENT_MASTER_KEY, so it cannot act for calls');
  req.hotel = await hotels.findById(claims.hotel);
  if (!req.hotel?.active) throw unauthorized('Unknown or inactive property');
  req.callClaims = claims;
  next();
}

export function createMcpRouter({ backendUrl = config.mcp.backendUrl } = {}) {
  const router = Router();

  router.post('/booking', perCaller, authenticateBooking, (req, res) => {
    const claims = req.callClaims;
    const headers = claims
      ? { 'x-api-key': config.agentMasterKey, 'x-hotel-id': String(req.hotel._id), 'x-call-id': claims.callId }
      : { 'x-api-key': req.get('x-api-key'), ...(req.get('x-hotel-id') ? { 'x-hotel-id': req.get('x-hotel-id') } : {}) };
    const audit = auditTo({ server: 'booking', hotel: String(req.hotel._id), call: claims?.callId });
    return serve(req, res, createBookingServer({ headers, baseUrl: backendUrl, claims, audit }));
  });

  router.post(
    '/staff/:hotelId',
    perCaller,
    requireAdmin,
    (req, res, next) => loadHotelParam(req, res, next, req.params.hotelId),
    (req, res) => {
      const audit = auditTo({ server: 'staff', hotel: String(req.hotel._id), call: req.user.email });
      return serve(req, res, createStaffServer({ hotel: req.hotel, user: req.user }, { audit }));
    },
  );

  router.all(['/booking', '/staff/:hotelId'], notAllowed);
  return router;
}
