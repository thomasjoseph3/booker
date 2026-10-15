import { config } from '../../config.js';
import { todayIn, upcomingDays } from '../../utils/dates.js';
import { money } from '../../utils/money.js';
import { round2 } from '../../utils/misc.js';

// Response shapes for the agent: compact, flat and free of internal ids it does not need.

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
export const roomTypeForAgent = (roomType) =>
  Object.fromEntries(Object.entries(roomType).filter(([key]) => !INTERNAL_FIELDS.includes(key)));
