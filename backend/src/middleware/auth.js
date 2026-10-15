import jwt from 'jsonwebtoken';
import mongoose from 'mongoose';
import { config } from '../config.js';
import { AdminUser, Hotel } from '../models/index.js';
import { forbidden, notFound, unauthorized } from '../utils/errors.js';

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

/** Property managers only (platform admins and hotel admins, not front-desk staff). */
export const managers = requireRole('super_admin', 'hotel_admin');
