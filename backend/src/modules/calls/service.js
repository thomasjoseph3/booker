import * as bookings from '../bookings/repository.js';
import * as guests from '../guests/repository.js';
import { normalizePhone } from '../../utils/misc.js';
import * as repo from './repository.js';

/**
 * Raises a high-priority task for the front desk about a booking (failed refund, undeliverable message,
 * possible overbooking, ...). These show up under "Callbacks" in the admin.
 */
export function raiseStaffTask(hotel, booking, reason) {
  return repo.createCallback({
    hotel: hotel._id,
    name: booking.guestName,
    phone: booking.guestPhone,
    booking: booking._id,
    priority: 'high',
    reason,
    createdBy: 'system',
  });
}

/** An agent asks for a human to call the guest back. */
export async function requestCallback(hotel, { bookingCode, ...data }, actor) {
  const booking = bookingCode ? await bookings.findByCode(hotel._id, bookingCode) : null;
  return repo.createCallback({
    ...data,
    phone: normalizePhone(data.phone),
    hotel: hotel._id,
    booking: booking?._id,
    createdBy: actor.label,
  });
}

/** An external agent runtime reports a finished (or ongoing) call: transcript lines are appended, other fields set. */
export async function recordCall(hotel, { callId, transcript, bookingCodes, ...fields }) {
  const update = { $set: fields, $setOnInsert: { hotel: hotel._id, callId } };
  if (transcript?.length) update.$push = { transcript: { $each: transcript.map((t) => ({ ...t, at: t.at || new Date() })) } };
  if (bookingCodes?.length) update.$addToSet = { bookings: { $each: await bookings.idsForCodes(hotel._id, bookingCodes) } };
  if (fields.fromNumber) {
    const guest = await guests.findByPhone(hotel._id, normalizePhone(fields.fromNumber));
    if (guest) update.$set.guest = guest._id;
  }
  return repo.upsertCall(hotel._id, callId, update);
}

/** Housekeeping: closes call records that were left open by a crash or restart. */
export const closeStaleCalls = (olderThanMinutes) => repo.closeStaleCalls(new Date(Date.now() - olderThanMinutes * 60 * 1000));

export const listCalls = repo.listCalls;
export const findCall = repo.findCall;
export const listCallbacks = repo.listCallbacks;
export const updateCallback = repo.updateCallback;
