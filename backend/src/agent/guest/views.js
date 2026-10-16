import { config } from '../../config.js';
import { todayIn, upcomingDays } from '../../utils/dates.js';
import { money } from '../../utils/money.js';
import { round2 } from '../../utils/misc.js';

// Response shapes for the agent: compact, flat and free of internal ids it does not need.

/**
 * Availability with one plain sentence per room type. The voice model once read the Garden Cottage's total off the
 * wrong entry of the nested quotes and quoted it for the Lake View Villa, so each room's price is spelled out next to
 * its name and the note says to quote from that sentence only.
 */
/** " N nights are at the X rate." when date-range rates apply to part of the stay, so the agent can explain the price. */
function specialNights(quote) {
  const counts = new Map();
  for (const n of quote.nightlyRates) if (n.label) counts.set(n.label, (counts.get(n.label) || 0) + 1);
  return [...counts].map(([label, n]) => ` ${n} of the nights are at the "${label}" rate.`).join('');
}

export function availabilityForAgent(result) {
  const options = result.options.map((o) => {
    const q = o.quote;
    const summary = o.bookable
      ? `${o.name}: ${money(q.currency, q.total)} in total for ${q.nights} nights including ${q.taxPercent}% tax (average ${money(q.currency, q.averageNightlyRate)} a night before tax); advance to confirm ${money(q.currency, q.advanceDue)}.${specialNights(q)}`
      : `${o.name}: not available for this party and these dates (${o.reason}).`;
    return { summary, ...o };
  });
  return {
    note: "Quote each room's total and advance only from that room's own `summary` (or its own `quote`). Never reuse one room's amount for another. Different rooms have different prices.",
    ...result,
    options,
  };
}

/** A booking as the agent sees it (optionally with the open payment link). */
export function agentBookingView(b, openPayment) {
  return {
    code: b.code,
    status: b.status,
    guestName: b.guestName,
    guestPhone: b.guestPhone,
    guestEmail: b.guestEmail,
    roomType: b.roomTypeName,
    roomTypeId: b.roomType?._id ?? b.roomType,
    roomsCount: b.roomsCount,
    checkIn: b.checkIn,
    checkOut: b.checkOut,
    nights: b.nights,
    adults: b.adults,
    children: b.children,
    specialRequests: b.specialRequests,
    currency: b.currency,
    subtotal: b.subtotal,
    tax: b.tax,
    total: b.total,
    advanceDue: b.advanceDue,
    amountPaid: round2(b.amountPaid - b.amountRefunded),
    balanceDue: b.balanceDue,
    paymentMode: b.paymentMode,
    // Minutes left rather than a UTC timestamp: the model mangles clock times when it speaks them in another language
    holdMinutesLeft: b.holdExpiresAt ? Math.max(0, Math.round((new Date(b.holdExpiresAt) - Date.now()) / 60000)) : undefined,
    paymentLink: openPayment?.paymentUrl,
    cancellation: b.status === 'cancelled' ? b.cancellation : undefined,
  };
}

/** Property facts the agent may quote: policies, amenities, FAQs, today's date at the property. */
export function hotelProfileForAgent(h) {
  const p = h.payment || {};
  const c = h.cancellation || {};
  const advance = {
    full: 'Full payment is required to confirm a booking.',
    percentage: `An advance of ${p.advancePercent}% of the total is required to confirm a booking; the balance is paid at the hotel.`,
    first_night: "The first night's charge is required in advance; the balance is paid at the hotel.",
    none: 'No advance payment is required; the full amount is paid at the hotel.',
  }[p.advanceMode || 'percentage'];
  return {
    id: h._id,
    name: h.name,
    propertyType: h.propertyType,
    description: h.description,
    starRating: h.starRating,
    address: h.address,
    contact: h.contact,
    timezone: h.timezone,
    todayAtProperty: todayIn(h.timezone),
    nextDays: upcomingDays(h.timezone),
    currency: h.currency,
    checkInTime: h.checkInTime,
    checkOutTime: h.checkOutTime,
    amenities: h.amenities,
    policies: h.policies,
    faqs: h.faqs,
    taxPercent: h.taxPercent,
    paymentPolicy:
      `${advance} Unpaid bookings are held for ${p.holdMinutes || 30} minutes after the payment link is sent.` +
      (p.allowPayAtHotel ? ' Guests may also choose to pay entirely at the hotel.' : ''),
    cancellationPolicy: `Free cancellation until ${c.freeUntilHours ?? 48} hours before check-in (${h.checkInTime}). After that, ${c.lateFeePercent ?? 50}% of the booking total is charged. No-shows are charged ${c.noShowFeePercent ?? 100}%.`,
    agent: { greeting: h.agent?.greeting, language: h.agent?.language, instructions: h.agent?.instructions },
  };
}

function whereSent(booking) {
  const ch = config.guestChannels;
  const parts = [];
  if (ch.includes('email') && booking.guestEmail) parts.push(`your email at ${booking.guestEmail}`);
  if (ch.includes('whatsapp')) parts.push(`your WhatsApp at ${booking.guestPhone}`);
  return `to ${parts.join(' and ') || 'you'}`;
}

/** Appended to what the agent says after a booking action, so it asks before the call is ended. */
export const ASK_ANYTHING_ELSE = 'Then ask once whether there is anything else you can help with, or whether you can end the call.';

/** What the agent says after a payment link was sent. */
export function paymentSentence(hotel, booking, payment) {
  if (!payment) return undefined;
  const minutes = booking.holdExpiresAt ? Math.max(1, Math.round((new Date(booking.holdExpiresAt) - Date.now()) / 60000)) : 0;
  const until = minutes ? ` Your room is held for you for the next ${minutes} minutes. Say the number of minutes, not a clock time.` : '';
  return `I've sent a payment link for ${money(hotel.currency, payment.amount)} ${whereSent(booking)}.${until} If the advance isn't paid by then, the room will be released. As soon as it's paid, you'll receive your confirmation and check-in details there too. Say the room is held (not yet confirmed) until the advance is paid. ${ASK_ANYTHING_ELSE}`;
}

const INTERNAL_FIELDS = ['hotel', '__v', 'createdAt', 'updatedAt'];

/** A room type without bookkeeping fields. */
/**
 * The date-range rates admins set on room types (Room types & pricing in the admin), for the dates still ahead.
 * `kind` says what the rate means for the caller, so the agent never calls a peak rate an offer:
 * "offer" is below the room's regular rate, "higher" is above every regular rate, "special" is in between.
 */
export function specialRatesForAgent(roomTypes, today, currency) {
  const rates = [];
  for (const rt of roomTypes) {
    const regular = [rt.basePrice, rt.weekendPrice].filter((p) => p != null);
    for (const o of rt.rateOverrides || []) {
      if (o.to < today) continue;
      const kind = o.price < Math.min(...regular) ? 'offer' : o.price > Math.max(...regular) ? 'higher' : 'special';
      rates.push({
        roomType: rt.name,
        roomTypeId: String(rt._id),
        name: o.label || 'Special rate',
        from: o.from > today ? o.from : today,
        to: o.to,
        pricePerNightBeforeTax: o.price,
        regularPricePerNightBeforeTax: rt.basePrice,
        kind,
        summary: `${rt.name}, ${o.label || 'special rate'}, ${o.from} to ${o.to}: ${money(currency, o.price)} a night before tax (${kind === 'offer' ? 'below' : kind === 'higher' ? 'above' : 'near'} the regular ${money(currency, rt.basePrice)}).`,
      });
    }
  }
  return {
    currency,
    taxNote: 'Rates are per night before tax; the hotel adds its tax percent on top. check_availability gives exact totals for dates.',
    note: 'Only describe these. If kind is "higher" it is a peak rate, not a discount. If the list is empty there are no special rates or offers right now: say so, and offer to quote regular prices.',
    specialRates: rates.sort((a, b) => a.from.localeCompare(b.from)),
  };
}

export const roomTypeForAgent = (roomType) =>
  Object.fromEntries(Object.entries(roomType).filter(([key]) => !INTERNAL_FIELDS.includes(key)));
