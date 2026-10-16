import { isWeekendNight, nightsBetween } from '../../utils/dates.js';
import { round2 } from '../../utils/misc.js';
import { bestOffer } from '../offers/rules.js';

/** The rate for one night, and the name of the special rate that set it (if a date-range override did). */
export function nightlyRate(roomType, night) {
  // Later overrides win, so admins can layer a specific event on top of a season.
  const override = [...(roomType.rateOverrides || [])].reverse().find((o) => night >= o.from && night <= o.to);
  if (override) return { price: override.price, label: override.label || 'special rate' };
  if (roomType.weekendPrice != null && isWeekendNight(night)) return { price: roomType.weekendPrice };
  return { price: roomType.basePrice };
}

export const nightlyPrice = (roomType, night) => nightlyRate(roomType, night).price;

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

/**
 * Prices a stay. `offers` are the hotel's active offers and `bookedOn` the day the booking is made (hotel time):
 * the biggest offer the stay qualifies for takes a percentage off the room charge, before tax.
 */
export function quoteStay(hotel, roomType, { checkIn, checkOut, roomsCount = 1 }, { offers = [], bookedOn } = {}) {
  const nights = nightsBetween(checkIn, checkOut);
  const nightlyRates = nights.map((date) => ({ date, ...nightlyRate(roomType, date) }));
  const perRoom = nightlyRates.reduce((sum, n) => sum + n.price, 0);
  const taxRate = (hotel.taxPercent || 0) / 100;
  const subtotalBeforeDiscount = round2(perRoom * roomsCount);
  const { best, almost } = offers.length && bookedOn
    ? bestOffer(offers, { roomTypeId: roomType._id, checkIn, checkOut, bookedOn })
    : { best: null, almost: [] };
  const discountAmount = best ? round2((subtotalBeforeDiscount * best.percentOff) / 100) : 0;
  const subtotal = round2(subtotalBeforeDiscount - discountAmount);
  const tax = round2(subtotal * taxRate);
  const total = round2(subtotal + tax);
  const keep = 1 - (best ? best.percentOff / 100 : 0);
  const firstNightTotal = round2(nightlyRates[0].price * roomsCount * keep * (1 + taxRate));
  // Each night with the offer and tax applied, so a caller can see how the nights add up to the total.
  // Any paise left over from rounding goes on the last night, so the nights always sum to the total exactly.
  const perNight = nightlyRates.map((n) => {
    const room = round2(n.price * roomsCount);
    const off = round2((room * (best?.percentOff || 0)) / 100);
    const net = round2(room - off);
    return { date: n.date, rate: n.price, roomCharge: room, offerOff: off, afterOffer: net, tax: round2(net * taxRate), total: round2(net * (1 + taxRate)) };
  });
  perNight.at(-1).total = round2(perNight.at(-1).total + round2(total - perNight.reduce((s, n) => s + n.total, 0)));
  return {
    perNight,
    discount: best ? { offerId: String(best._id), name: best.name, percent: best.percentOff, amount: discountAmount } : null,
    otherOffers: almost,
    subtotalBeforeDiscount,
    currency: hotel.currency,
    nights: nights.length,
    roomsCount,
    nightlyRates,
    averageNightlyRate: round2(perRoom / nights.length), // before any offer
    subtotal,
    tax,
    taxPercent: hotel.taxPercent || 0,
    total,
    advanceDue: advanceAmount(hotel, total, firstNightTotal),
  };
}
