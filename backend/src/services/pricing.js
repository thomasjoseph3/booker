import { isWeekendNight, nightsBetween } from '../utils/dates.js';
import { round2 } from '../utils/misc.js';

export function nightlyPrice(roomType, night) {
  // Later overrides win, so admins can layer a specific event on top of a season.
  const override = [...(roomType.rateOverrides || [])].reverse().find((o) => night >= o.from && night <= o.to);
  if (override) return override.price;
  if (roomType.weekendPrice != null && isWeekendNight(night)) return roomType.weekendPrice;
  return roomType.basePrice;
}

export function advanceAmount(hotel, total, firstNightTotal) {
  const p = hotel.payment || {};
  switch (p.advanceMode) {
    case 'full':
      return total;
    case 'first_night':
      return Math.min(total, firstNightTotal);
    case 'none':
      return 0;
    case 'percentage':
    default:
      return round2((total * (p.advancePercent ?? 30)) / 100);
  }
}

export function quoteStay(hotel, roomType, { checkIn, checkOut, roomsCount = 1 }) {
  const nights = nightsBetween(checkIn, checkOut);
  const nightlyRates = nights.map((date) => ({ date, price: nightlyPrice(roomType, date) }));
  const perRoom = nightlyRates.reduce((sum, n) => sum + n.price, 0);
  const taxRate = (hotel.taxPercent || 0) / 100;
  const subtotal = round2(perRoom * roomsCount);
  const tax = round2(subtotal * taxRate);
  const total = round2(subtotal + tax);
  const firstNightTotal = round2(nightlyRates[0].price * roomsCount * (1 + taxRate));
  return {
    currency: hotel.currency,
    nights: nights.length,
    roomsCount,
    nightlyRates,
    averageNightlyRate: round2(perRoom / nights.length),
    subtotal,
    tax,
    taxPercent: hotel.taxPercent || 0,
    total,
    advanceDue: advanceAmount(hotel, total, firstNightTotal),
  };
}
