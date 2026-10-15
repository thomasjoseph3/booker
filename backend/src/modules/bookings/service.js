import { Booking, Callback, Guest, Hotel, Payment, Room, RoomType } from '../../models/index.js';
import { addDays, isValidDay, nightsBetween, todayIn, zonedToUtc } from '../../utils/dates.js';
import { badRequest, conflict, notFound } from '../../utils/errors.js';
import { bookingCode, escapeRegex, normalizePhone, round2, samePhone } from '../../utils/misc.js';
import { availabilityFor, releaseInventory, reserveInventory } from '../inventory/service.js';
import { notifyGuest } from '../notifications/service.js';
import { getProvider } from '../payments/providers/index.js';
import { quoteStay } from './pricing.js';

const MAX_NIGHTS = 30;
const MODIFIABLE = ['pending_payment', 'confirmed'];

const histEntry = (action, actor, note) => ({ at: new Date(), action, by: actor?.label || 'system', note });
const netPaid = (b) => round2((b.amountPaid || 0) - (b.amountRefunded || 0));

// ---------- validation helpers ----------

function assertStayDates(hotel, checkIn, checkOut) {
  if (!isValidDay(checkIn) || !isValidDay(checkOut)) throw badRequest('Dates must be in YYYY-MM-DD format');
  if (checkOut <= checkIn) throw badRequest('Check-out must be after check-in');
  const today = todayIn(hotel.timezone);
  if (checkIn < today) throw badRequest(`Check-in date ${checkIn} is in the past (today is ${today} at the property)`);
  if (checkIn > addDays(today, 730)) throw badRequest('Bookings can be made up to 2 years in advance');
  if (nightsBetween(checkIn, checkOut).length > MAX_NIGHTS) throw badRequest(`Stays longer than ${MAX_NIGHTS} nights must be arranged with the front desk`);
}

function roomsNeededFor(rt, adults, children) {
  if (children > 0 && rt.maxChildren === 0) return Infinity;
  return Math.max(
    Math.ceil(adults / rt.maxAdults),
    rt.maxChildren ? Math.ceil(children / rt.maxChildren) : 0,
    Math.ceil((adults + children) / rt.maxOccupancy),
  );
}

function assertOccupancy(rt, adults, children, roomsCount) {
  const needed = roomsNeededFor(rt, adults, children);
  if (needed > roomsCount) {
    throw badRequest(
      `${rt.name} fits up to ${rt.maxAdults} adults, ${rt.maxChildren} children and ${rt.maxOccupancy} guests per room; ` +
        `${adults} adults and ${children} children need at least ${needed === Infinity ? 'a different room type' : `${needed} rooms`}`,
      { roomsNeeded: needed === Infinity ? null : needed },
    );
  }
  if (roomsCount > adults) throw badRequest('Each room needs at least one adult');
}

// ---------- availability ----------

export async function searchAvailability(hotel, { checkIn, checkOut, adults = 1, children = 0, roomsCount = 1 }) {
  assertStayDates(hotel, checkIn, checkOut);
  const roomTypes = await RoomType.find({ hotel: hotel._id, active: true }).lean();
  const avail = await availabilityFor(roomTypes, checkIn, checkOut);
  const options = roomTypes.map((rt) => {
    const needed = roomsNeededFor(rt, adults, children);
    const fits = Number.isFinite(needed);
    const rooms = fits ? Math.max(roomsCount, needed) : roomsCount;
    const availableRooms = avail.get(String(rt._id));
    return {
      roomTypeId: rt._id,
      code: rt.code,
      name: rt.name,
      description: rt.description,
      bedType: rt.bedType,
      view: rt.view,
      sizeSqft: rt.sizeSqft,
      maxAdults: rt.maxAdults,
      maxChildren: rt.maxChildren,
      maxOccupancy: rt.maxOccupancy,
      amenities: rt.amenities,
      availableRooms,
      roomsNeeded: fits ? rooms : null,
      bookable: fits && availableRooms >= rooms,
      reason: !fits ? 'Room type does not accommodate this party' : availableRooms < rooms ? 'Not enough rooms available for these dates' : undefined,
      quote: quoteStay(hotel, rt, { checkIn, checkOut, roomsCount: rooms }),
    };
  });
  options.sort((a, b) => Number(b.bookable) - Number(a.bookable) || a.quote.total - b.quote.total);
  return { checkIn, checkOut, nights: nightsBetween(checkIn, checkOut).length, adults, children, currency: hotel.currency, options };
}

// ---------- guests ----------

async function upsertGuest(hotel, { name, phone, email }) {
  const normalized = normalizePhone(phone);
  const update = { $set: { name, ...(email ? { email } : {}) } };
  try {
    return await Guest.findOneAndUpdate({ hotel: hotel._id, phone: normalized }, update, { upsert: true, returnDocument: 'after' });
  } catch (e) {
    if (e.code !== 11000) throw e; // lost an upsert race; the doc exists now
    return Guest.findOneAndUpdate({ hotel: hotel._id, phone: normalized }, update, { returnDocument: 'after' });
  }
}

// ---------- payments ----------

async function cancelOpenPaymentLinks(booking) {
  const open = await Payment.find({ booking: booking._id, kind: 'charge', status: 'created' });
  for (const p of open) {
    if (p.providerRef && p.provider !== 'offline') await getProvider(p.provider).cancelPaymentLink(p.providerRef);
    await Payment.updateOne({ _id: p._id, status: 'created' }, { $set: { status: 'cancelled' } });
  }
}

async function createPaymentRequest(hotel, booking, amount, purpose) {
  const provider = getProvider();
  const payment = await Payment.create({
    hotel: hotel._id,
    booking: booking._id,
    provider: provider.name,
    purpose,
    amount: round2(amount),
    currency: hotel.currency,
    expiresAt: booking.status === 'pending_payment' ? booking.holdExpiresAt : new Date(Date.now() + 24 * 3600 * 1000),
  });
  try {
    const { providerRef, url } = await provider.createPaymentLink({ payment, booking, hotel });
    payment.providerRef = providerRef;
    payment.paymentUrl = url;
    await payment.save();
  } catch (e) {
    payment.status = 'failed';
    payment.note = e.message;
    await payment.save();
    throw e;
  }
  await notifyGuest(hotel, booking, 'payment_link', { amount: payment.amount, url: payment.paymentUrl, expiresAt: payment.expiresAt });
  return payment;
}

async function refundBooking(hotel, booking, amount, actor) {
  let remaining = round2(amount);
  const charges = await Payment.find({ booking: booking._id, kind: 'charge', status: 'paid' }).sort({ paidAt: -1 });
  for (const charge of charges) {
    if (remaining <= 0) break;
    const prior = await Payment.find({ refundOf: charge._id, status: { $in: ['refunded', 'refund_pending'] } });
    const refundable = round2(charge.amount - prior.reduce((s, r) => s + r.amount, 0));
    const take = Math.min(remaining, refundable);
    if (take <= 0) continue;
    const base = { hotel: hotel._id, booking: booking._id, kind: 'refund', purpose: 'refund', amount: take, currency: charge.currency, refundOf: charge._id, recordedBy: actor?.label };
    if (charge.provider === 'offline') {
      await Payment.create({ ...base, provider: 'offline', method: charge.method, status: 'refund_pending', note: 'Return manually to guest (paid offline)' });
    } else {
      try {
        const r = await getProvider(charge.provider).refund({ payment: charge, amount: take });
        await Payment.create({ ...base, provider: charge.provider, providerRef: r.providerRef, status: r.status });
      } catch (e) {
        await Payment.create({ ...base, provider: charge.provider, status: 'refund_pending', note: `Automatic refund failed: ${e.message}` });
        await Callback.create({ hotel: hotel._id, name: booking.guestName, phone: booking.guestPhone, booking: booking._id, priority: 'high', reason: `Refund of ${take} for ${booking.code} failed at the gateway — process manually`, createdBy: 'system' });
      }
    }
    remaining = round2(remaining - take);
  }
  const refunded = round2(amount - remaining);
  if (refunded > 0) {
    await Booking.updateOne({ _id: booking._id }, { $inc: { amountRefunded: refunded }, $push: { history: histEntry('refund', actor, `Refund ${refunded}`) } });
  }
  return refunded;
}

async function releaseHeld(booking, fromDay) {
  let start = fromDay && fromDay > booking.checkIn ? fromDay : booking.checkIn;
  if (start > booking.checkOut) start = booking.checkOut;
  const r = await Booking.updateOne({ _id: booking._id, inventoryHeld: true }, { $set: { inventoryHeld: false, inventoryReleasedFrom: start } });
  if (r.modifiedCount !== 1) return;
  if (start < booking.checkOut) await releaseInventory(booking.roomType, start, booking.checkOut, booking.roomsCount);
}

// ---------- create ----------

export async function createBooking(hotel, input, actor) {
  const { checkIn, checkOut, adults, children = 0, roomsCount = 1 } = input;
  assertStayDates(hotel, checkIn, checkOut);
  const rt = await RoomType.findOne({ _id: input.roomTypeId, hotel: hotel._id, active: true });
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
    const doc = {
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
      holdExpiresAt: needsPayment ? new Date(Date.now() + (hotel.payment?.holdMinutes || 30) * 60 * 1000) : undefined,
      inventoryHeld: true,
      source: input.source || (actor.type === 'agent' ? 'phone_agent' : 'admin'),
      specialRequests: input.specialRequests,
      callId: input.callId,
      history: [histEntry('created', actor, needsPayment ? `Awaiting advance of ${quote.advanceDue}` : 'Confirmed without advance')],
    };
    for (let attempt = 0; ; attempt += 1) {
      try {
        booking = await Booking.create({ ...doc, code: bookingCode() });
        break;
      } catch (e) {
        if (e.code !== 11000 || attempt >= 4) throw e;
      }
    }
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
      await Booking.updateOne({ _id: booking._id }, { $push: { history: histEntry('payment_link_failed', actor, e.message) } });
    }
  } else {
    await notifyGuest(hotel, booking, 'confirmed');
  }
  return { booking, payment, paymentError };
}

// ---------- payment outcomes ----------

export async function handlePaymentSuccess({ paymentId, providerRef, providerPaymentId, amount }) {
  const filter = paymentId ? { _id: paymentId } : { providerRef };
  const payment = await Payment.findOneAndUpdate(
    { ...filter, kind: 'charge', status: { $in: ['created', 'expired', 'cancelled', 'failed'] } },
    { $set: { status: 'paid', paidAt: new Date(), ...(providerPaymentId ? { providerPaymentId } : {}) } },
    { returnDocument: 'after' },
  );
  if (!payment) return { processed: false }; // unknown or already processed (webhooks are retried)

  const paid = round2(amount ?? payment.amount);
  if (paid !== payment.amount) await Payment.updateOne({ _id: payment._id }, { $set: { amount: paid } });
  const actor = { label: `payment:${payment.provider}` };
  await Booking.updateOne({ _id: payment.booking }, { $inc: { amountPaid: paid }, $push: { history: histEntry('payment_received', actor, `${paid} via ${payment.provider}`) } });

  const hotel = await Hotel.findById(payment.hotel);
  let booking = await Booking.findOneAndUpdate(
    { _id: payment.booking, status: 'pending_payment' },
    { $set: { status: 'confirmed' }, $unset: { holdExpiresAt: 1 }, $push: { history: histEntry('confirmed', actor) } },
    { returnDocument: 'after' },
  );
  if (booking) {
    await cancelOpenPaymentLinks(booking);
    await notifyGuest(hotel, booking, 'confirmed');
    return { processed: true, booking };
  }

  booking = await Booking.findById(payment.booking);
  if (booking.status === 'expired') {
    // Money arrived after the hold lapsed: try to re-take the rooms.
    const rt = await RoomType.findById(booking.roomType);
    try {
      await reserveInventory(rt, booking.checkIn, booking.checkOut, booking.roomsCount);
      const revived = await Booking.findOneAndUpdate(
        { _id: booking._id, status: 'expired' },
        { $set: { status: 'confirmed', inventoryHeld: true }, $unset: { inventoryReleasedFrom: 1 }, $push: { history: histEntry('confirmed', actor, 'Late payment; rooms re-reserved') } },
        { returnDocument: 'after' },
      );
      if (revived) {
        await notifyGuest(hotel, revived, 'confirmed');
        return { processed: true, booking: revived };
      }
      await releaseInventory(rt._id, booking.checkIn, booking.checkOut, booking.roomsCount);
    } catch (e) {
      if (e.code !== 'NO_AVAILABILITY') throw e;
    }
    booking = await Booking.findById(payment.booking);
  }
  if (['expired', 'cancelled'].includes(booking.status)) {
    await refundBooking(hotel, booking, paid, actor);
    await Callback.create({ hotel: hotel._id, name: booking.guestName, phone: booking.guestPhone, booking: booking._id, priority: 'high', reason: `Payment received for ${booking.status} booking ${booking.code}; refunded automatically. Call guest to rebook.`, createdBy: 'system' });
    await notifyGuest(hotel, booking, 'payment_issue');
  }
  return { processed: true, booking };
}

export async function handlePaymentExpired({ providerRef }) {
  await Payment.updateOne({ providerRef, status: 'created' }, { $set: { status: 'expired' } });
}

export async function recordOfflinePayment(hotel, booking, { amount, method, note }, actor) {
  if (['cancelled', 'expired'].includes(booking.status)) throw conflict('INVALID_STATE', `Booking is ${booking.status}`);
  const payment = await Payment.create({
    hotel: hotel._id, booking: booking._id, provider: 'offline', method, amount: round2(amount), currency: hotel.currency,
    purpose: booking.status === 'pending_payment' ? 'advance' : 'balance', status: 'paid', paidAt: new Date(), recordedBy: actor.label, note,
  });
  await Booking.updateOne({ _id: booking._id }, { $inc: { amountPaid: payment.amount }, $push: { history: histEntry('payment_received', actor, `${payment.amount} by ${method}`) } });
  const confirmed = await Booking.findOneAndUpdate(
    { _id: booking._id, status: 'pending_payment' },
    { $set: { status: 'confirmed' }, $unset: { holdExpiresAt: 1 }, $push: { history: histEntry('confirmed', actor) } },
    { returnDocument: 'after' },
  );
  if (confirmed) {
    await cancelOpenPaymentLinks(confirmed);
    await notifyGuest(hotel, confirmed, 'confirmed');
  }
  return { payment, booking: await Booking.findById(booking._id) };
}

export async function resendPaymentLink(hotel, booking, actor) {
  if (booking.status === 'pending_payment') {
    const holdExpiresAt = new Date(Date.now() + (hotel.payment?.holdMinutes || 30) * 60 * 1000);
    const updated = await Booking.findOneAndUpdate(
      { _id: booking._id, status: 'pending_payment' },
      { $set: { holdExpiresAt }, $push: { history: histEntry('payment_link_resent', actor) } },
      { returnDocument: 'after' },
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

export async function cancelBooking(hotel, booking, { reason, waiveFee = false }, actor) {
  const q = cancellationQuote(hotel, booking);
  if (!q.cancellable) throw conflict('NOT_CANCELLABLE', q.reason);
  const refundAmount = waiveFee ? q.amountPaid : q.refundAmount;
  const fee = round2(q.amountPaid - refundAmount);
  const updated = await Booking.findOneAndUpdate(
    { _id: booking._id, status: { $in: MODIFIABLE } },
    {
      $set: { status: 'cancelled', cancellation: { at: new Date(), by: actor.label, reason, fee, refundAmount } },
      $unset: { holdExpiresAt: 1 },
      $push: { history: histEntry('cancelled', actor, reason) },
    },
    { returnDocument: 'after' },
  );
  if (!updated) throw conflict('NOT_CANCELLABLE', 'Booking changed state; please retry');
  await releaseHeld(updated);
  await cancelOpenPaymentLinks(updated);
  if (refundAmount > 0) await refundBooking(hotel, updated, refundAmount, actor);
  await notifyGuest(hotel, updated, 'cancelled', { refundAmount });
  return { booking: await Booking.findById(updated._id), fee, refundAmount };
}

// ---------- modify ----------

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
  const rt = await RoomType.findOne({ _id: next.roomTypeId, hotel: hotel._id, active: true });
  if (!rt) throw notFound('Room type');
  assertOccupancy(rt, next.adults, next.children, next.roomsCount);

  const stayChanged =
    String(rt._id) !== String(booking.roomType) || next.checkIn !== booking.checkIn || next.checkOut !== booking.checkOut || next.roomsCount !== booking.roomsCount;

  const set = { adults: next.adults, children: next.children };
  if (changes.specialRequests !== undefined) set.specialRequests = changes.specialRequests;
  const notes = [];

  if (stayChanged) {
    assertStayDates(hotel, next.checkIn, next.checkOut);
    // Free the current rooms first so a guest can extend or shift into nights overlapping their own stay.
    await releaseInventory(booking.roomType, booking.checkIn, booking.checkOut, booking.roomsCount);
    try {
      await reserveInventory(rt, next.checkIn, next.checkOut, next.roomsCount);
    } catch (e) {
      const oldRt = await RoomType.findById(booking.roomType);
      await reserveInventory(oldRt, booking.checkIn, booking.checkOut, booking.roomsCount).catch(async () => {
        await Callback.create({ hotel: hotel._id, name: booking.guestName, phone: booking.guestPhone, booking: booking._id, priority: 'high', reason: `Inventory for ${booking.code} could not be restored after a failed modification — check for overbooking`, createdBy: 'system' });
      });
      throw e;
    }
    const quote = quoteStay(hotel, rt, next);
    Object.assign(set, {
      roomType: rt._id, roomTypeName: rt.name, checkIn: next.checkIn, checkOut: next.checkOut, roomsCount: next.roomsCount,
      nights: quote.nights, nightlyRates: quote.nightlyRates, subtotal: quote.subtotal, tax: quote.tax, total: quote.total,
      advanceDue: booking.paymentMode === 'online' ? quote.advanceDue : 0,
    });
    notes.push(`${booking.roomTypeName} ${booking.checkIn}→${booking.checkOut} x${booking.roomsCount} ⇒ ${rt.name} ${next.checkIn}→${next.checkOut} x${next.roomsCount}; total ${booking.total} ⇒ ${quote.total}`);
  }

  const updated = await Booking.findOneAndUpdate(
    { _id: booking._id, status: { $in: MODIFIABLE } },
    { $set: set, $push: { history: histEntry('modified', actor, notes.join('; ') || 'Guest details updated') } },
    { returnDocument: 'after' },
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
  return { booking: await Booking.findById(updated._id), payment, refunded };
}

// ---------- front desk ----------

export async function checkInBooking(hotel, booking, { roomIds } = {}, actor) {
  if (booking.status !== 'confirmed') throw conflict('INVALID_STATE', `Only confirmed bookings can be checked in (this one is ${booking.status})`);
  const today = todayIn(hotel.timezone);
  if (today < booking.checkIn || today >= booking.checkOut) throw conflict('NOT_ARRIVAL_DAY', `Check-in is allowed from ${booking.checkIn}`);

  let candidates;
  if (roomIds?.length) {
    if (roomIds.length !== booking.roomsCount) throw badRequest(`Assign exactly ${booking.roomsCount} room(s)`);
    candidates = roomIds;
  } else {
    const free = await Room.find({ hotel: hotel._id, roomType: booking.roomType, status: 'available' }).sort({ number: 1 }).limit(booking.roomsCount);
    candidates = free.length === booking.roomsCount ? free.map((r) => r._id) : [];
  }
  const taken = [];
  for (const id of candidates) {
    const r = await Room.updateOne({ _id: id, hotel: hotel._id, roomType: booking.roomType, status: 'available' }, { $set: { status: 'occupied' } });
    if (r.modifiedCount !== 1) {
      await Room.updateMany({ _id: { $in: taken } }, { $set: { status: 'available' } });
      throw conflict('ROOM_UNAVAILABLE', 'One of the selected rooms is not available or is not of the booked room type');
    }
    taken.push(id);
  }
  const updated = await Booking.findOneAndUpdate(
    { _id: booking._id, status: 'confirmed' },
    { $set: { status: 'checked_in', assignedRooms: taken, checkedInAt: new Date() }, $push: { history: histEntry('checked_in', actor, taken.length ? `${taken.length} room(s) assigned` : undefined) } },
    { returnDocument: 'after' },
  );
  if (!updated) {
    await Room.updateMany({ _id: { $in: taken } }, { $set: { status: 'available' } });
    throw conflict('INVALID_STATE', 'Booking changed state; please retry');
  }
  return updated.populate('assignedRooms', 'number floor');
}

export async function checkOutBooking(hotel, booking, { force = false } = {}, actor) {
  if (booking.status !== 'checked_in') throw conflict('INVALID_STATE', `Booking is ${booking.status}`);
  if (booking.balanceDue > 0 && !force) {
    throw conflict('BALANCE_DUE', `Balance of ${hotel.currency} ${booking.balanceDue} is due. Record the payment first or pass force=true.`, { balanceDue: booking.balanceDue });
  }
  const updated = await Booking.findOneAndUpdate(
    { _id: booking._id, status: 'checked_in' },
    { $set: { status: 'checked_out', checkedOutAt: new Date() }, $push: { history: histEntry('checked_out', actor, booking.balanceDue > 0 ? `Left with balance ${booking.balanceDue}` : undefined) } },
    { returnDocument: 'after' },
  );
  if (!updated) throw conflict('INVALID_STATE', 'Booking changed state; please retry');
  await Room.updateMany({ _id: { $in: updated.assignedRooms } }, { $set: { status: 'cleaning' } });
  await releaseHeld(updated, todayIn(hotel.timezone)); // early departure frees remaining nights
  return updated;
}

export async function markNoShow(hotel, booking, actor) {
  if (booking.status !== 'confirmed') throw conflict('INVALID_STATE', `Booking is ${booking.status}`);
  if (todayIn(hotel.timezone) < booking.checkIn) throw conflict('NOT_ARRIVAL_DAY', 'Cannot mark no-show before the arrival date');
  const updated = await Booking.findOneAndUpdate(
    { _id: booking._id, status: 'confirmed' },
    { $set: { status: 'no_show' }, $push: { history: histEntry('no_show', actor) } },
    { returnDocument: 'after' },
  );
  if (!updated) throw conflict('INVALID_STATE', 'Booking changed state; please retry');
  await releaseHeld(updated, todayIn(hotel.timezone));
  const fee = round2((updated.total * (hotel.cancellation?.noShowFeePercent ?? 100)) / 100);
  const refund = round2(netPaid(updated) - fee);
  if (refund > 0) await refundBooking(hotel, updated, refund, actor);
  return Booking.findById(updated._id);
}

// ---------- background sweep ----------

export async function expireHolds(now = new Date()) {
  const due = await Booking.find({ status: 'pending_payment', holdExpiresAt: { $lte: now } }).select('_id');
  let expired = 0;
  for (const { _id } of due) {
    const b = await Booking.findOneAndUpdate(
      { _id, status: 'pending_payment', holdExpiresAt: { $lte: now } },
      { $set: { status: 'expired' }, $push: { history: histEntry('expired', null, 'Advance not received before hold expired') } },
      { returnDocument: 'after' },
    );
    if (!b) continue;
    await releaseHeld(b);
    await cancelOpenPaymentLinks(b);
    await notifyGuest(await Hotel.findById(b.hotel), b, 'expired');
    expired += 1;
  }
  await Payment.updateMany({ kind: 'charge', status: 'created', expiresAt: { $lte: now } }, { $set: { status: 'expired' } });
  return expired;
}

// ---------- lookups ----------

export async function findByCode(hotel, code) {
  const booking = await Booking.findOne({ hotel: hotel._id, code: String(code).trim().toUpperCase() });
  if (!booking) throw notFound('Booking');
  return booking;
}

/** Caller-facing lookup: a booking code must match the caller's phone, so callers can't read others' bookings. */
export async function findForCaller(hotel, { code, phone }) {
  if (code) {
    const booking = await Booking.findOne({ hotel: hotel._id, code: String(code).trim().toUpperCase() });
    if (!booking || !samePhone(booking.guestPhone, phone)) throw notFound('Booking for this phone number');
    return [booking];
  }
  const last10 = String(phone).replace(/\D/g, '').slice(-10);
  if (last10.length < 7) throw badRequest('A valid phone number is required');
  return Booking.find({
    hotel: hotel._id,
    guestPhone: new RegExp(`${escapeRegex(last10)}$`),
    status: { $in: ['pending_payment', 'confirmed', 'checked_in'] },
    checkOut: { $gte: todayIn(hotel.timezone) },
  }).sort({ checkIn: 1 });
}

export async function latestOpenPayment(booking) {
  return Payment.findOne({ booking: booking._id, kind: 'charge', status: 'created' }).sort({ createdAt: -1 });
}
