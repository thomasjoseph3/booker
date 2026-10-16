import { Router } from 'express';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { requireAdmin, loadHotelParam } from '../middleware/auth.js';
import { rateLimit } from '../middleware/rateLimit.js';
import { requireAgent, requireHotelContext } from '../agent/guest/auth.js';
import { createBookingServer, createStaffServer } from './servers.js';

/**
 * MCP over HTTP (the "streamable HTTP" transport), stateless: every request gets its own server instance, so nothing
 * is kept between requests and several API instances need no shared state.
 *
 *   POST /mcp/booking            x-api-key: the hotel's agent key   (master key + x-hotel-id also works)
 *   POST /mcp/staff/:hotelId     Authorization: Bearer <admin login token>
 */
const router = Router();

// Each request can reach the database and the paid model APIs, so cap how fast one caller can go.
const perCaller = rateLimit({ windowMs: 60 * 1000, max: 120, key: (req) => req.get('x-api-key') || req.get('authorization') || req.ip });

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

router.post('/booking', perCaller, requireAgent, requireHotelContext, (req, res) => {
  const headers = { 'x-api-key': req.get('x-api-key') };
  if (req.get('x-hotel-id')) headers['x-hotel-id'] = req.get('x-hotel-id');
  return serve(req, res, createBookingServer({ headers, baseUrl: `http://127.0.0.1:${req.socket.localPort}` }));
});

router.post(
  '/staff/:hotelId',
  perCaller,
  requireAdmin,
  (req, res, next) => loadHotelParam(req, res, next, req.params.hotelId),
  (req, res) => serve(req, res, createStaffServer({ hotel: req.hotel, user: req.user })),
);

router.all(['/booking', '/staff/:hotelId'], notAllowed);

export default router;
