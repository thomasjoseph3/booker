import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import mongoose from 'mongoose';
import { config } from '../config.js';
import { AdminUser, Hotel } from '../models/index.js';
import { badRequest, forbidden, notFound, unauthorized } from '../utils/errors.js';
import { sha256 } from '../utils/misc.js';

export function signToken(user) {
  return jwt.sign({ sub: String(user._id), role: user.role }, config.jwtSecret, { expiresIn: config.jwtExpiresIn });
}

export async function requireAdmin(req, res, next) {
  const header = req.get('authorization') || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) throw unauthorized('Missing bearer token');
  let payload;
  try {
    payload = jwt.verify(token, config.jwtSecret);
  } catch {
    throw unauthorized('Invalid or expired token');
  }
  const user = await AdminUser.findById(payload.sub);
  if (!user || !user.active) throw unauthorized('User is disabled');
  req.user = user;
  req.actor = { type: 'admin', label: `admin:${user.email}` };
  next();
}

export const requireRole = (...roles) => (req, res, next) => {
  if (!roles.includes(req.user.role)) throw forbidden(`Requires role: ${roles.join(' or ')}`);
  next();
};

export function canAccessHotel(user, hotelId) {
  return user.role === 'super_admin' || user.hotels.some((h) => String(h) === String(hotelId));
}

// router.param handler for :hotelId
export async function loadHotelParam(req, res, next, hotelId) {
  if (!mongoose.isValidObjectId(hotelId)) throw notFound('Hotel');
  if (!canAccessHotel(req.user, hotelId)) throw forbidden('You do not have access to this property');
  const hotel = await Hotel.findById(hotelId);
  if (!hotel) throw notFound('Hotel');
  req.hotel = hotel;
  next();
}

function safeEqual(a, b) {
  const ha = crypto.createHash('sha256').update(a).digest();
  const hb = crypto.createHash('sha256').update(b).digest();
  return crypto.timingSafeEqual(ha, hb);
}

/**
 * Voice-agent auth. Either a per-hotel key (scoped to that hotel) or the platform
 * master key plus an `x-hotel-id` header (one agent deployment serving many properties).
 */
export async function requireAgent(req, res, next) {
  const key = req.get('x-api-key');
  if (!key) throw unauthorized('Missing x-api-key header');
  if ((config.agentMasterKey && safeEqual(key, config.agentMasterKey)) || safeEqual(key, config.internalAgentKey)) {
    req.agentScope = 'master';
    // x-hotel-id accepts the hotel's id or its slug (slugs stay stable across re-seeds/environments)
    const hotelRef = req.get('x-hotel-id');
    if (hotelRef) {
      const byId = mongoose.isValidObjectId(hotelRef) && /^[a-f\d]{24}$/i.test(hotelRef);
      req.hotel = await Hotel.findOne({ ...(byId ? { _id: hotelRef } : { slug: hotelRef.toLowerCase() }), active: true });
      if (!req.hotel) throw notFound('Hotel');
    }
  } else {
    const hotel = await Hotel.findOne({ 'agent.apiKeyHash': sha256(key), active: true });
    if (!hotel) throw unauthorized('Invalid API key');
    req.hotel = hotel;
    req.agentScope = 'hotel';
  }
  const callId = req.get('x-call-id');
  req.actor = { type: 'agent', label: callId ? `agent:${callId}` : 'agent' };
  next();
}

export function requireHotelContext(req, res, next) {
  if (!req.hotel) throw badRequest('x-hotel-id header is required when using the master key');
  next();
}
