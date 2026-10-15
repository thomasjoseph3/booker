import { notFound } from '../../utils/errors.js';
import { normalizePhone, round2 } from '../../utils/misc.js';
import * as bookings from '../bookings/repository.js';
import * as calls from '../calls/repository.js';
import * as repo from './repository.js';

export const upsertGuest = (hotel, { name, phone, email }) => repo.upsertByPhone(hotel._id, normalizePhone(phone), { name, email });

/** Guest list with each guest's booking count, completed stays and lifetime spend. */
export async function listGuests(hotel, text, page) {
  const result = await repo.search(hotel._id, text, page);
  const stats = new Map((await bookings.statsByGuest(result.items.map((g) => g._id))).map((s) => [String(s._id), s]));
  result.items = result.items.map((guest) => {
    const s = stats.get(String(guest._id)) || {};
    return { ...guest.toObject(), bookings: s.bookings || 0, stays: s.stays || 0, spent: round2(s.spent || 0), lastStay: s.lastStay || null };
  });
  return result;
}

export async function guestProfile(hotel, id) {
  const guest = await repo.findById(hotel._id, id);
  if (!guest) throw notFound('Guest');
  const [guestBookings, guestCalls] = await Promise.all([bookings.listForGuest(guest._id), calls.callsForGuest(hotel._id, guest)]);
  return { guest, bookings: guestBookings, calls: guestCalls };
}

export async function updateGuest(hotel, id, changes) {
  const guest = await repo.update(hotel._id, id, changes);
  if (!guest) throw notFound('Guest');
  return guest;
}
