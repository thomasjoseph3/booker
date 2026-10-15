import crypto from 'node:crypto';
import { config } from '../../config.js';
import * as hotels from '../../modules/hotels/repository.js';
import { badRequest, notFound, unauthorized } from '../../utils/errors.js';
import { sha256 } from '../../utils/misc.js';

const safeEqual = (a, b) =>
  crypto.timingSafeEqual(crypto.createHash('sha256').update(a).digest(), crypto.createHash('sha256').update(b).digest());

/**
 * Agent authentication. Either a per-hotel key (scoped to that hotel), or the platform master key
 * plus an `x-hotel-id` header (one agent deployment serving many properties). The built-in agents
 * use an in-process master key that is regenerated on every boot.
 */
export async function requireAgent(req, res, next) {
  const key = req.get('x-api-key');
  if (!key) throw unauthorized('Missing x-api-key header');

  const isMaster = (config.agentMasterKey && safeEqual(key, config.agentMasterKey)) || safeEqual(key, config.internalAgentKey);
  if (isMaster) {
    req.agentScope = 'master';
    // x-hotel-id accepts the hotel's id or its slug (slugs stay stable across re-seeds/environments)
    const hotelRef = req.get('x-hotel-id');
    if (hotelRef) {
      req.hotel = await hotels.findActiveByRef(hotelRef);
      if (!req.hotel) throw notFound('Hotel');
    }
  } else {
    const hotel = await hotels.findActiveByAgentKeyHash(sha256(key));
    if (!hotel) throw unauthorized('Invalid API key');
    req.hotel = hotel;
    req.agentScope = 'hotel';
  }
  const callId = req.get('x-call-id');
  req.actor = { type: 'agent', label: callId ? `agent:${callId}` : 'agent' };
  next();
}

/** Master-key requests must say which property they act on. */
export function requireHotelContext(req, res, next) {
  if (!req.hotel) throw badRequest('x-hotel-id header is required when using the master key');
  next();
}
