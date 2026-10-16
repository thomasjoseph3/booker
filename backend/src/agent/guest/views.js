import { config } from '../../config.js';
import { todayIn, upcomingDays } from '../../utils/dates.js';
import { money, spokenMoney } from '../../utils/money.js';
import { round2 } from '../../utils/misc.js';
import { describeConditions } from '../../modules/offers/rules.js';

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

/** " An offer is already applied: ..." and " Offers they are close to: ..." so the agent explains the discount and can suggest meeting a condition. */
function offerText(q) {
  let text = '';
  if (q.discount)
    text += ` The "${q.discount.name}" offer is already included: ${q.discount.percent}% off the room charge, saving ${money(q.currency, q.discount.amount)} before tax (room charge ${money(q.currency, q.subtotalBeforeDiscount)} before the offer).`;
  for (const o of q.otherOffers || []) text += ` The "${o.name}" offer (${o.percentOff}% off) applies if they ${o.needs}.`;
  return text;
}

/** The sum behind a quote, step by step, for when the caller asks "how is that worked out?". */
export function calculationFor(q) {
  const groups = new Map();
  for (const n of q.nightlyRates) groups.set(n.price, (groups.get(n.price) || 0) + 1);
  const rooms = q.roomsCount > 1 ? ` x ${q.roomsCount} rooms` : '';
  const steps = [`Room charge: ${[...groups].map(([price, n]) => `${n} night${n === 1 ? '' : 's'} at ${spokenMoney(q.currency, price)}`).join(' and ')}${rooms} = ${spokenMoney(q.currency, q.subtotalBeforeDiscount)}.`];
  if (q.discount) steps.push(`Offer "${q.discount.name}": ${q.discount.percent}% off = minus ${spokenMoney(q.currency, q.discount.amount)}, so ${spokenMoney(q.currency, q.subtotal)}.`);
  if (q.perNight && (q.nights > 1 || q.discount)) {
    const day = (d) => new Date(`${d}T00:00:00Z`).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' });
    steps.push(
      `Night by night, with the offer and tax already in each night (these add up to the total): ${q.perNight.map((n) => `${day(n.date)} ${spokenMoney(q.currency, n.total)}`).join(', ')}.`,
    );
    if (q.discount) steps.push('The offer applies to the whole stay, so a price quoted for a single night on its own does not include it and is higher.');
  }
  steps.push(`Tax ${q.taxPercent}% on ${spokenMoney(q.currency, q.subtotal)} = ${spokenMoney(q.currency, q.tax)}.`);
  steps.push(`Total = ${spokenMoney(q.currency, q.subtotal)} + ${spokenMoney(q.currency, q.tax)} = ${spokenMoney(q.currency, q.total)}.`);
  steps.push(`Advance to confirm = ${spokenMoney(q.currency, q.advanceDue)}.`);
  return steps;
}

/** One room type's option for a specific number of rooms (the price_stay tool). */
export function priceStayForAgent(result, roomType, requestedRooms = 1) {
  const key = String(roomType || '').trim().toLowerCase();
  const option = result.options.find((o) => [String(o.roomTypeId), o.code, o.name].some((v) => String(v).toLowerCase() === key))
    ?? result.options.find((o) => o.name.toLowerCase().includes(key));
  if (!option) return { error: `No room type matches "${roomType}". Room types: ${result.options.map((o) => o.name).join(', ')}.` };
  const [view] = availabilityForAgent({ ...result, options: [option] }).options;
  const needed = option.roomsNeeded ?? requestedRooms;
  return {
    note: 'Say these figures exactly. Do not add, multiply or round anything yourself: if the caller wants another combination, call price_stay again or use calculate.',
    ...(needed > requestedRooms
      ? { warning: `The caller asked for ${requestedRooms} room${requestedRooms === 1 ? '' : 's'} but this party cannot fit in fewer than ${needed} ${option.name} rooms, so the price below is for ${needed}. Say that ${requestedRooms} ${requestedRooms === 1 ? 'room is' : 'rooms are'} not enough for them and quote only this price for ${needed}. Never scale, divide or estimate a price for ${requestedRooms}.` }
      : {}),
    checkIn: result.checkIn,
    checkOut: result.checkOut,
    nights: result.nights,
    roomsCount: option.roomsNeeded ?? undefined,
    ...view,
  };
}

/** Several price_stay lines (a mix of rooms) with the grand total added up here, not by the model. */
export function combineQuotes(lines) {
  const failed = lines.find((l) => l.error);
  if (failed) return failed;
  const sum = (f) => round2(lines.reduce((s, l) => s + f(l), 0));
  const currency = lines[0].quote.currency;
  const total = sum((l) => l.quote.total);
  const advance = sum((l) => l.quote.advanceDue);
  const unavailable = lines.filter((l) => !l.bookable).map((l) => l.name);
  return {
    note: 'Say the grand total and the advance exactly as given. Each line is a separate room type, so these are separate bookings, one per room type (a booking holds one room type).',
    checkIn: lines[0].checkIn,
    checkOut: lines[0].checkOut,
    nights: lines[0].nights,
    currency,
    unavailable: unavailable.length ? unavailable : undefined,
    summary: `${lines.map((l) => `${l.roomsCount ?? 1} x ${l.name}: ${money(currency, l.quote.total)}`).join(' + ')} = ${spokenMoney(currency, total)} in total including tax; advance to confirm ${spokenMoney(currency, advance)} (${lines.map((l) => money(currency, l.quote.advanceDue)).join(' + ')}).`,
    grandTotal: total,
    grandAdvance: advance,
    lines,
  };
}

export function availabilityForAgent(result) {
  const options = result.options.map((o) => {
    const q = o.quote;
    const summary = o.bookable
      ? `${o.name}${o.roomsNeeded > 1 ? ` (${o.roomsNeeded} rooms are needed for this party)` : ''}: ${spokenMoney(q.currency, q.total)} in total for ${q.nights} nights including ${q.taxPercent}% tax${q.discount ? ' and after the offer' : ''}; advance to confirm ${spokenMoney(q.currency, q.advanceDue)}.${offerText(q)}${specialNights(q)}${q.discount ? '' : ` (average ${money(q.currency, q.averageNightlyRate)} a night before tax)`}`
      : `${o.name}: not available for this party and these dates (${o.reason}).`;
    return { summary, ...(o.bookable ? { calculation: calculationFor(q) } : {}), ...o };
  });
  return {
    note: "Quote each room's total and advance only from that room's own `summary` (or its own `quote`). Never reuse one room's amount for another. Different rooms have different prices. A room's `calculation` lists the steps behind its price: read those steps if asked how it is worked out, and never do the sums yourself. For another number of rooms or different dates, call price_stay.",
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
    offerApplied: b.discountName ? `${b.discountName}: ${b.discountPercent}% off the room charge, saving ${money(b.currency, b.discountAmount)} before tax` : undefined,
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
export function specialRatesForAgent(roomTypes, today, currency, offers = []) {
  const rates = [];
  const typeNames = new Map(roomTypes.map((rt) => [String(rt._id), rt.name]));
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
    note: 'Only describe these. If kind is "higher" it is a peak rate, not a discount. "offers" are real percentage discounts that are applied automatically at check_availability and booking when the stay meets the conditions: say the percent and every condition, and never promise one the stay does not meet. If both lists are empty there are no special rates or offers right now: say so, and offer to quote regular prices.',
    offers: offers.map((o) => ({
      name: o.name,
      percentOff: o.percentOff,
      conditions: describeConditions(o, o.roomTypes.map((id) => typeNames.get(String(id))).filter(Boolean)),
      summary: `${o.name}: ${o.percentOff}% off the room charge before tax if they ${describeConditions(o, o.roomTypes.map((id) => typeNames.get(String(id))).filter(Boolean))}.${o.description ? ` ${o.description}` : ''}`,
    })),
    specialRates: rates.sort((a, b) => a.from.localeCompare(b.from)),
  };
}

export const roomTypeForAgent = (roomType) =>
  Object.fromEntries(Object.entries(roomType).filter(([key]) => !INTERNAL_FIELDS.includes(key)));
