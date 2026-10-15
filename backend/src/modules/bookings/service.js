import { todayIn, zonedToUtc } from '../../utils/dates.js';
import { badRequest, conflict, notFound } from '../../utils/errors.js';
import { round2, samePhone } from '../../utils/misc.js';
import * as callsRepo from '../calls/repository.js';
import { raiseStaffTask } from '../calls/service.js';
import { upsertGuest } from '../guests/service.js';
import * as hotels from '../hotels/repository.js';
import { releaseInventory, reserveInventory } from '../inventory/service.js';
import * as notificationsRepo from '../notifications/repository.js';
import { notifyGuest } from '../notifications/service.js';
import * as paymentsRepo from '../payments/repository.js';
import { cancelOpenPaymentLinks, createPaymentRequest, refundBooking } from '../payments/service.js';
import * as rooms from '../rooms/repository.js';
import { histEntry, netPaid } from './history.js';
import { quoteStay } from './pricing.js';
import * as repo from './repository.js';
import { assertOccupancy, assertStayDates } from './stayRules.js';

/**
 * Booking lifecycle: create, pay, modify, cancel, check in/out, no-show and hold expiry.
 *
 * Every status change goes through `repo.transition`, which only applies if the booking is still in the
 * expected state, so two simultaneous requests (or a retried webhook) cannot both win.
 */

const MODIFIABLE = ['pending_payment', 'confirmed'];
const holdMillis = (hotel) => (hotel.payment?.holdMinutes || 30) * 60 * 1000;

const CONFIRM = (actor, note) => ({
  set: { status: 'confirmed' },
  unset: { holdExpiresAt: 1 },
  history: histEntry('confirmed', actor, note),
});

/** Gives the booking's rooms back to inventory (from `fromDay` on, for early departures). Safe to call twice. */
async function releaseHeld(booking, fromDay) {
  let start = fromDay && fromDay > booking.checkIn ? fromDay : booking.checkIn;
  if (start > booking.checkOut) start = booking.checkOut;
  if (!(await repo.markInventoryReleased(booking._id, start))) return;
  if (start < booking.checkOut) await releaseInventory(booking.roomType, start, booking.checkOut, booking.roomsCount);
}

// ---------- create ----------

/**
 * Books a stay: validates, reserves inventory atomically, creates the booking and, when an advance is
 * due, a payment link (the room is held until `holdMinutes` pass). `paymentError` is set when only the
 * link failed, so the caller can retry it without losing the hold.
 */
export async function createBooking(hotel, input, actor) {
  const { checkIn, checkOut, adults, children = 0, roomsCount = 1 } = input;
  assertStayDates(hotel, checkIn, checkOut);
  const rt = await rooms.findActiveType(hotel._id, input.roomTypeId);
  if (!rt) throw notFound('Room type');
  assertOccupancy(rt, adults, children, roomsCount);

  const paymentMode = input.paymentMode || 'online';
  if (paymentMode === 'pay_at_hotel' && !hotel.payment?.allowPayAtHotel && actor.type !== 'admin') {
    throw badRequest('This property requires an advance payment to confirm bookings');
  }
  const quote = quoteStay(hotel, rt, { checkIn, checkOut, roomsCount });
  const needsPayment = paymentMode === 'online' && quote.advanceDue > 0;
  const guest = await upsertGuest(hotel, input.guest);

  await reserveInventory(rt, checkIn, checkOut, roomsCount);

  let booking;
  try {
    booking = await repo.createWithUniqueCode({
      hotel: hotel._id,
      guest: guest._id,
      guestName: guest.name,
      guestPhone: guest.phone,
      guestEmail: guest.email,
      roomType: rt._id,
      roomTypeName: rt.name,
      roomsCount,
      checkIn,
      checkOut,
      nights: quote.nights,
      adults,
      children,
      nightlyRates: quote.nightlyRates,
      currency: quote.currency,
      subtotal: quote.subtotal,
      tax: quote.tax,
      total: quote.total,
      advanceDue: paymentMode === 'online' ? quote.advanceDue : 0,
      paymentMode,
      status: needsPayment ? 'pending_payment' : 'confirmed',
      holdExpiresAt: needsPayment ? new Date(Date.now() + holdMillis(hotel)) : undefined,
      inventoryHeld: true,
      source: input.source || (actor.type === 'agent' ? 'phone_agent' : 'admin'),
      specialRequests: input.specialRequests,
      callId: input.callId,
      history: [histEntry('created', actor, needsPayment ? `Awaiting advance of ${quote.advanceDue}` : 'Confirmed without advance')],
    });
  } catch (e) {
    await releaseInventory(rt._id, checkIn, checkOut, roomsCount);
    throw e;
  }

  let payment = null;
  let paymentError;
  if (needsPayment) {
    try {
      payment = await createPaymentRequest(hotel, booking, quote.advanceDue, 'advance');
    } catch (e) {
      // Keep the hold; the agent can retry with "resend payment link" while the caller is on the line.
      paymentError = e.message;
      await repo.pushHistory(booking._id, histEntry('payment_link_failed', actor, e.message));
    }
  } else {
    await notifyGuest(hotel, booking, 'confirmed');
  }
  return { booking, payment, paymentError };
}

// ---------- payment outcomes ----------

/**
 * A payment succeeded (gateway webhook or the test pay page). Idempotent: a repeated notification does nothing.
 * Normally confirms the booking. If the hold already lapsed it tries to re-take the rooms; if that is impossible
 * the money is refunded and the front desk is asked to call the guest.
 */
export async function handlePaymentSuccess({ paymentId, providerRef, providerPaymentId, amount }) {
  const payment = await paymentsRepo.claimAsPaid({ paymentId, providerRef, providerPaymentId });
  if (!payment) return { processed: false }; // unknown or already processed (webhooks are retried)

  const paid = round2(amount ?? payment.amount);
  if (paid !== payment.amount) await paymentsRepo.setAmount(payment._id, paid);
  const actor = { label: `payment:${payment.provider}` };
  await repo.addPayment(payment.booking, paid, histEntry('payment_received', actor, `${paid} via ${payment.provider}`));

  const hotel = await hotels.findById(payment.hotel);
  let booking = await repo.transition({ _id: payment.booking, status: 'pending_payment' }, CONFIRM(actor));
  if (booking) {
    await cancelOpenPaymentLinks(booking);
    await notifyGuest(hotel, booking, 'confirmed');
    return { processed: true, booking };
  }

  booking = await repo.findById(payment.booking);
  if (booking.status === 'expired') {
    // Money arrived after the hold lapsed: try to re-take the rooms.
    const rt = await rooms.findTypeById(booking.roomType);
    try {
      await reserveInventory(rt, booking.checkIn, booking.checkOut, booking.roomsCount);
      const revived = await repo.transition(
        { _id: booking._id, status: 'expired' },
        {
          set: { status: 'confirmed', inventoryHeld: true },
          unset: { inventoryReleasedFrom: 1 },
          history: histEntry('confirmed', actor, 'Late payment; rooms re-reserved'),
        },
      );
      if (revived) {
        await notifyGuest(hotel, revived, 'confirmed');
        return { processed: true, booking: revived };
      }
      await releaseInventory(rt._id, booking.checkIn, booking.checkOut, booking.roomsCount);
    } catch (e) {
      if (e.code !== 'NO_AVAILABILITY') throw e;
    }
    booking = await repo.findById(payment.booking);
  }
  if (['expired', 'cancelled'].includes(booking.status)) {
    await refundBooking(hotel, booking, paid, actor);
    await raiseStaffTask(
      hotel,
      booking,
      `Payment received for ${booking.status} booking ${booking.code}; refunded automatically. Call guest to rebook.`,
    );
    await notifyGuest(hotel, booking, 'payment_issue');
  }
  return { processed: true, booking };
}

export const handlePaymentExpired = ({ providerRef }) => paymentsRepo.expireByProviderRef(providerRef);

/** Front desk records cash, card, UPI or bank transfer received outside the gateway. */
export async function recordOfflinePayment(hotel, booking, { amount, method, note }, actor) {
  if (['cancelled', 'expired'].includes(booking.status)) throw conflict('INVALID_STATE', `Booking is ${booking.status}`);
  const payment = await paymentsRepo.create({
    hotel: hotel._id,
    booking: booking._id,
    provider: 'offline',
    method,
    amount: round2(amount),
    currency: hotel.currency,
    purpose: booking.status === 'pending_payment' ? 'advance' : 'balance',
    status: 'paid',
    paidAt: new Date(),
    recordedBy: actor.label,
    note,
  });
  await repo.addPayment(booking._id, payment.amount, histEntry('payment_received', actor, `${payment.amount} by ${method}`));
  const confirmed = await repo.transition({ _id: booking._id, status: 'pending_payment' }, CONFIRM(actor));
  if (confirmed) {
    await cancelOpenPaymentLinks(confirmed);
    await notifyGuest(hotel, confirmed, 'confirmed');
  }
  return { payment, booking: await repo.findById(booking._id) };
}

/** New payment link: extends the hold for a booking awaiting its advance, or asks for the balance of a confirmed one. */
export async function resendPaymentLink(hotel, booking, actor) {
  if (booking.status === 'pending_payment') {
    const updated = await repo.transition(
      { _id: booking._id, status: 'pending_payment' },
      { set: { holdExpiresAt: new Date(Date.now() + holdMillis(hotel)) }, history: histEntry('payment_link_resent', actor) },
    );
    if (!updated) throw conflict('INVALID_STATE', 'Booking is no longer awaiting payment');
    await cancelOpenPaymentLinks(updated);
    return createPaymentRequest(hotel, updated, round2(updated.advanceDue - netPaid(updated)), 'advance');
  }
  if (booking.status === 'confirmed' || booking.status === 'checked_in') {
    const due = booking.balanceDue;
    if (due <= 0) throw conflict('NOTHING_DUE', 'Nothing is due on this booking');
    await cancelOpenPaymentLinks(booking);
    return createPaymentRequest(hotel, booking, due, 'balance');
  }
  throw conflict('INVALID_STATE', `Booking is ${booking.status}`);
}

// ---------- cancel ----------

/** What cancelling would cost right now, per the property's policy. */
export function cancellationQuote(hotel, booking, now = new Date()) {
  if (!MODIFIABLE.includes(booking.status)) {
    return { cancellable: false, reason: `Booking is ${booking.status.replace('_', ' ')}` };
  }
  const paid = netPaid(booking);
  const c = hotel.cancellation || {};
  const checkInAt = zonedToUtc(booking.checkIn, hotel.checkInTime, hotel.timezone);
  const hoursBeforeCheckIn = Math.round(((checkInAt - now) / 3.6e6) * 10) / 10;
  const free = booking.status === 'pending_payment' || hoursBeforeCheckIn >= (c.freeUntilHours ?? 48);
  const policyFee = free ? 0 : round2((booking.total * (c.lateFeePercent ?? 50)) / 100);
  const fee = Math.min(policyFee, paid);
  return {
    cancellable: true,
    freeCancellation: free,
    hoursBeforeCheckIn,
    freeUntilHours: c.freeUntilHours ?? 48,
    amountPaid: paid,
    fee,
    refundAmount: round2(paid - fee),
    currency: hotel.currency,
    policy: `Free cancellation up to ${c.freeUntilHours ?? 48} hours before check-in; after that ${c.lateFeePercent ?? 50}% of the booking total is charged.`,
  };
}

/** Cancels, releases the rooms, voids open payment links, refunds per policy (or in full with `waiveFee`) and tells the guest. */
export async function cancelBooking(hotel, booking, { reason, waiveFee = false }, actor) {
  const quote = cancellationQuote(hotel, booking);
  if (!quote.cancellable) throw conflict('NOT_CANCELLABLE', quote.reason);
  const refundAmount = waiveFee ? quote.amountPaid : quote.refundAmount;
  const fee = round2(quote.amountPaid - refundAmount);
  const updated = await repo.transition(
    { _id: booking._id, status: { $in: MODIFIABLE } },
    {
      set: { status: 'cancelled', cancellation: { at: new Date(), by: actor.label, reason, fee, refundAmount } },
      unset: { holdExpiresAt: 1 },
      history: histEntry('cancelled', actor, reason),
    },
  );
  if (!updated) throw conflict('NOT_CANCELLABLE', 'Booking changed state; please retry');
  await releaseHeld(updated);
  await cancelOpenPaymentLinks(updated);
  if (refundAmount > 0) await refundBooking(hotel, updated, refundAmount, actor);
  await notifyGuest(hotel, updated, 'cancelled', { refundAmount });
  return { booking: await repo.findById(updated._id), fee, refundAmount };
}

// ---------- modify ----------

/**
 * Changes dates, room type, rooms, guests or requests. A changed stay is re-priced and its inventory moved
 * (old rooms are freed first so a guest can extend into their own nights); then a new payment link or a
 * refund is issued for the difference.
 */
export async function modifyBooking(hotel, booking, changes, actor) {
  if (!MODIFIABLE.includes(booking.status)) throw conflict('NOT_MODIFIABLE', `Booking is ${booking.status}`);
  const next = {
    roomTypeId: changes.roomTypeId || String(booking.roomType),
    checkIn: changes.checkIn || booking.checkIn,
    checkOut: changes.checkOut || booking.checkOut,
    adults: changes.adults ?? booking.adults,
    children: changes.children ?? booking.children,
    roomsCount: changes.roomsCount ?? booking.roomsCount,
  };
  const rt = await rooms.findActiveType(hotel._id, next.roomTypeId);
  if (!rt) throw notFound('Room type');
  assertOccupancy(rt, next.adults, next.children, next.roomsCount);

  const stayChanged =
    String(rt._id) !== String(booking.roomType) ||
    next.checkIn !== booking.checkIn ||
    next.checkOut !== booking.checkOut ||
    next.roomsCount !== booking.roomsCount;

  const set = { adults: next.adults, children: next.children };
  if (changes.specialRequests !== undefined) set.specialRequests = changes.specialRequests;
  const notes = [];

  if (stayChanged) {
    assertStayDates(hotel, next.checkIn, next.checkOut);
    await releaseInventory(booking.roomType, booking.checkIn, booking.checkOut, booking.roomsCount);
    try {
      await reserveInventory(rt, next.checkIn, next.checkOut, next.roomsCount);
    } catch (e) {
      const oldType = await rooms.findTypeById(booking.roomType);
      await reserveInventory(oldType, booking.checkIn, booking.checkOut, booking.roomsCount).catch(() =>
        raiseStaffTask(
          hotel,
          booking,
          `Inventory for ${booking.code} could not be restored after a failed modification — check for overbooking`,
        ),
      );
      throw e;
    }
    const quote = quoteStay(hotel, rt, next);
    Object.assign(set, {
      roomType: rt._id,
      roomTypeName: rt.name,
      checkIn: next.checkIn,
      checkOut: next.checkOut,
      roomsCount: next.roomsCount,
      nights: quote.nights,
      nightlyRates: quote.nightlyRates,
      subtotal: quote.subtotal,
      tax: quote.tax,
      total: quote.total,
      advanceDue: booking.paymentMode === 'online' ? quote.advanceDue : 0,
    });
    notes.push(
      `${booking.roomTypeName} ${booking.checkIn}→${booking.checkOut} x${booking.roomsCount} ⇒ ${rt.name} ${next.checkIn}→${next.checkOut} x${next.roomsCount}; total ${booking.total} ⇒ ${quote.total}`,
    );
  }

  const updated = await repo.transition(
    { _id: booking._id, status: { $in: MODIFIABLE } },
    { set, history: histEntry('modified', actor, notes.join('; ') || 'Guest details updated') },
  );
  if (!updated) throw conflict('NOT_MODIFIABLE', 'Booking changed state; please retry');

  let payment = null;
  let refunded = 0;
  if (stayChanged) {
    const paid = netPaid(updated);
    if (updated.status === 'pending_payment') {
      await cancelOpenPaymentLinks(updated);
      payment = await createPaymentRequest(hotel, updated, round2(updated.advanceDue - paid), 'advance');
    } else if (paid > updated.total) {
      refunded = await refundBooking(hotel, updated, round2(paid - updated.total), actor);
    } else if (updated.paymentMode === 'online' && paid < updated.advanceDue) {
      await cancelOpenPaymentLinks(updated);
      payment = await createPaymentRequest(hotel, updated, round2(updated.advanceDue - paid), 'top_up');
    }
    await notifyGuest(hotel, updated, 'modified');
  }
  return { booking: await repo.findById(updated._id), payment, refunded };
}

// ---------- front desk ----------

/** Checks a confirmed booking in and assigns physical rooms (the given ones, or the lowest-numbered free ones). */
export async function checkInBooking(hotel, booking, { roomIds } = {}, actor) {
  if (booking.status !== 'confirmed')
    throw conflict('INVALID_STATE', `Only confirmed bookings can be checked in (this one is ${booking.status})`);
  const today = todayIn(hotel.timezone);
  if (today < booking.checkIn || today >= booking.checkOut)
    throw conflict('NOT_ARRIVAL_DAY', `Check-in is allowed from ${booking.checkIn}`);

  let candidates;
  if (roomIds?.length) {
    if (roomIds.length !== booking.roomsCount) throw badRequest(`Assign exactly ${booking.roomsCount} room(s)`);
    candidates = roomIds;
  } else {
    const free = await rooms.findAvailableRooms(hotel._id, booking.roomType, booking.roomsCount);
    candidates = free.length === booking.roomsCount ? free.map((r) => r._id) : [];
  }
  const taken = [];
  for (const id of candidates) {
    if (!(await rooms.occupyIfAvailable(hotel._id, booking.roomType, id))) {
      await rooms.setStatus(taken, 'available');
      throw conflict('ROOM_UNAVAILABLE', 'One of the selected rooms is not available or is not of the booked room type');
    }
    taken.push(id);
  }
  const updated = await repo.transition(
    { _id: booking._id, status: 'confirmed' },
    {
      set: { status: 'checked_in', assignedRooms: taken, checkedInAt: new Date() },
      history: histEntry('checked_in', actor, taken.length ? `${taken.length} room(s) assigned` : undefined),
    },
  );
  if (!updated) {
    await rooms.setStatus(taken, 'available');
    throw conflict('INVALID_STATE', 'Booking changed state; please retry');
  }
  return updated.populate('assignedRooms', 'number floor');
}

/** Checks out; refuses with an unpaid balance unless forced. The rooms go to housekeeping and unused nights are released. */
export async function checkOutBooking(hotel, booking, { force = false } = {}, actor) {
  if (booking.status !== 'checked_in') throw conflict('INVALID_STATE', `Booking is ${booking.status}`);
  if (booking.balanceDue > 0 && !force) {
    throw conflict(
      'BALANCE_DUE',
      `Balance of ${hotel.currency} ${booking.balanceDue} is due. Record the payment first or pass force=true.`,
      { balanceDue: booking.balanceDue },
    );
  }
  const updated = await repo.transition(
    { _id: booking._id, status: 'checked_in' },
    {
      set: { status: 'checked_out', checkedOutAt: new Date() },
      history: histEntry('checked_out', actor, booking.balanceDue > 0 ? `Left with balance ${booking.balanceDue}` : undefined),
    },
  );
  if (!updated) throw conflict('INVALID_STATE', 'Booking changed state; please retry');
  await rooms.setStatus(updated.assignedRooms, 'cleaning');
  await releaseHeld(updated, todayIn(hotel.timezone)); // early departure frees remaining nights
  return updated;
}

/** Guest did not arrive: keeps the no-show fee from what was paid and refunds the rest. */
export async function markNoShow(hotel, booking, actor) {
  if (booking.status !== 'confirmed') throw conflict('INVALID_STATE', `Booking is ${booking.status}`);
  if (todayIn(hotel.timezone) < booking.checkIn) throw conflict('NOT_ARRIVAL_DAY', 'Cannot mark no-show before the arrival date');
  const updated = await repo.transition(
    { _id: booking._id, status: 'confirmed' },
    { set: { status: 'no_show' }, history: histEntry('no_show', actor) },
  );
  if (!updated) throw conflict('INVALID_STATE', 'Booking changed state; please retry');
  await releaseHeld(updated, todayIn(hotel.timezone));
  const fee = round2((updated.total * (hotel.cancellation?.noShowFeePercent ?? 100)) / 100);
  const refund = round2(netPaid(updated) - fee);
  if (refund > 0) await refundBooking(hotel, updated, refund, actor);
  return repo.findById(updated._id);
}

// ---------- background sweep ----------

/** Expires bookings whose payment hold ran out, frees their rooms and tells the guests. Returns how many expired. */
export async function expireHolds(now = new Date()) {
  let expired = 0;
  for (const id of await repo.dueHolds(now)) {
    const booking = await repo.transition(
      { _id: id, status: 'pending_payment', holdExpiresAt: { $lte: now } },
      { set: { status: 'expired' }, history: histEntry('expired', null, 'Advance not received before hold expired') },
    );
    if (!booking) continue;
    await releaseHeld(booking);
    await cancelOpenPaymentLinks(booking);
    await notifyGuest(await hotels.findById(booking.hotel), booking, 'expired');
    expired += 1;
  }
  await paymentsRepo.expireOverdueCharges(now);
  return expired;
}

// ---------- lookups ----------

export async function findByCode(hotel, code) {
  const booking = await repo.findByCode(hotel._id, code);
  if (!booking) throw notFound('Booking');
  return booking;
}

/** Caller-facing lookup: a booking code must match the caller's phone, so callers can't read others' bookings. */
export async function findForCaller(hotel, { code, phone }) {
  if (code) {
    const booking = await repo.findByCode(hotel._id, code);
    if (!booking || !samePhone(booking.guestPhone, phone)) throw notFound('Booking for this phone number');
    return [booking];
  }
  const last10 = String(phone).replace(/\D/g, '').slice(-10);
  if (last10.length < 7) throw badRequest('A valid phone number is required');
  return repo.findUpcomingByPhone(hotel, last10);
}

export const latestOpenPayment = (booking) => paymentsRepo.latestOpenCharge(booking._id);

export const searchBookings = repo.search;
export const findById = repo.findById;

/** Everything the admin booking page shows: guest, rooms, payments, messages sent and calls. */
export async function bookingDetail(hotel, code) {
  const booking = await repo.populateDetail(await findByCode(hotel, code));
  const [payments, notifications, calls] = await Promise.all([
    paymentsRepo.forBooking(booking._id),
    notificationsRepo.forBooking(booking._id),
    callsRepo.callsForBooking(booking._id),
  ]);
  return { booking, payments, notifications, calls, cancellationQuote: cancellationQuote(hotel, booking) };
}

export async function addNote(hotel, code, note, actor) {
  const booking = await findByCode(hotel, code);
  await repo.pushHistory(booking._id, { at: new Date(), action: 'note', by: actor.label, note });
}
