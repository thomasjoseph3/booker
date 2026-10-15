import crypto from 'node:crypto';
import { config } from '../config.js';

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O/1/I — easy to read out on a call

export function bookingCode() {
  const bytes = crypto.randomBytes(6);
  let s = '';
  for (const b of bytes) s += CODE_ALPHABET[b % CODE_ALPHABET.length];
  return `BK${s}`;
}

// Returns E.164 ("+919847012345"). Local numbers get the default country code; WhatsApp needs E.164.
export function normalizePhone(phone) {
  if (!phone) return phone;
  const trimmed = String(phone).trim();
  let digits = trimmed.replace(/\D/g, '');
  if (trimmed.startsWith('+')) return `+${digits}`;
  if (trimmed.startsWith('00')) return `+${digits.slice(2)}`;
  digits = digits.replace(/^0+/, '');
  if (digits.length <= 10) return `+${config.defaultCountryCode}${digits}`;
  return `+${digits}`;
}

// Compares the last 10 digits so "+91 98470 12345" matches "9847012345".
export function samePhone(a, b) {
  if (!a || !b) return false;
  return String(a).replace(/\D/g, '').slice(-10) === String(b).replace(/\D/g, '').slice(-10);
}

export const round2 = (n) => Math.round(n * 100) / 100;

export const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');

export function generateApiKey(prefix = 'hk') {
  return `${prefix}_${crypto.randomBytes(24).toString('base64url')}`;
}

export function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
