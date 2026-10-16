import { addDays, nightsBetween } from '../../utils/dates.js';

const daysBetween = (from, to) => Math.round((new Date(`${to}T00:00:00Z`) - new Date(`${from}T00:00:00Z`)) / 86400000);
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

/**
 * Does this offer apply to this stay? Conditions that the guest cannot change by choosing differently
 * (room type, stay window, booking deadline) make the offer "not applicable". Conditions the guest could
 * meet (more nights, booking earlier) are returned in `needs` so the agent can suggest them.
 * @returns {{applies: boolean, needs: string[]}}
 */
export function evaluateOffer(offer, { roomTypeId, checkIn, checkOut, bookedOn }) {
  const none = { applies: false, needs: [] };
  if (!offer.active) return none;
  const types = (offer.roomTypes || []).map(String);
  if (types.length && !types.includes(String(roomTypeId))) return none;
  if (offer.bookUntil && bookedOn > offer.bookUntil) return none;
  const lastNight = addDays(checkOut, -1);
  if ((offer.stayFrom && checkIn < offer.stayFrom) || (offer.stayTo && lastNight > offer.stayTo)) return none;

  const needs = [];
  const nights = nightsBetween(checkIn, checkOut).length;
  if (offer.minNights && nights < offer.minNights) needs.push(`stay at least ${plural(offer.minNights, 'night')}`);
  if (offer.bookAheadDays && daysBetween(bookedOn, checkIn) < offer.bookAheadDays)
    needs.push(`book at least ${plural(offer.bookAheadDays, 'day')} before check-in`);
  return { applies: needs.length === 0, needs };
}

/** The offer a stay gets (the biggest one that applies) and offers it nearly gets. */
export function bestOffer(offers, stay) {
  let best = null;
  const almost = [];
  for (const o of offers) {
    const r = evaluateOffer(o, stay);
    if (r.applies) {
      if (!best || o.percentOff > best.percentOff) best = o;
    } else if (r.needs.length) almost.push({ name: o.name, percentOff: o.percentOff, needs: r.needs.join(' and ') });
  }
  return { best, almost: almost.sort((a, b) => b.percentOff - a.percentOff).slice(0, 3) };
}

/** An offer's conditions in plain words, for the agent and the admin list. */
export function describeConditions(offer, typeNames = []) {
  const parts = [];
  if (offer.minNights) parts.push(`stay at least ${plural(offer.minNights, 'night')}`);
  if (offer.bookAheadDays) parts.push(`book at least ${plural(offer.bookAheadDays, 'day')} before check-in`);
  if (offer.stayFrom || offer.stayTo)
    parts.push(offer.stayFrom && offer.stayTo ? `stay between ${offer.stayFrom} and ${offer.stayTo}` : offer.stayFrom ? `stay from ${offer.stayFrom}` : `stay until ${offer.stayTo}`);
  if (offer.bookUntil) parts.push(`book by ${offer.bookUntil}`);
  if (typeNames.length) parts.push(`only for ${typeNames.join(' or ')}`);
  return parts.length ? parts.join('; ') : 'no conditions';
}
