import { BOOKING_STATUSES, Booking } from '../../models/index.js';
import { todayIn } from '../../utils/dates.js';
import { bookingCode, escapeRegex } from '../../utils/misc.js';
import { paginate } from '../../utils/pagination.js';

// ---------- reads ----------

export const findById = (id) => Booking.findById(id);

export const findByCode = (hotelId, code) => Booking.findOne({ hotel: hotelId, code: String(code).trim().toUpperCase() });

export const idsForCodes = (hotelId, codes) => Booking.find({ hotel: hotelId, code: { $in: codes.map((c) => c.toUpperCase()) } }).distinct('_id');

export const listForGuest = (guestId) => Booking.find({ guest: guestId }).select('-history -nightlyRates').sort({ checkIn: -1 });

/** Upcoming bookings of a caller, matched on the last 10 digits of their phone number. */
export const findUpcomingByPhone = (hotel, last10) =>
  Booking.find({
    hotel: hotel._id,
    guestPhone: new RegExp(`${escapeRegex(last10)}$`),
    status: { $in: ['pending_payment', 'confirmed', 'checked_in'] },
    checkOut: { $gte: todayIn(hotel.timezone) },
  }).sort({ checkIn: 1 });

export const populateDetail = (booking) => booking.populate([{ path: 'assignedRooms', select: 'number floor' }, { path: 'guest' }]);

export const dueHolds = async (now) => (await Booking.find({ status: 'pending_payment', holdExpiresAt: { $lte: now } }).select('_id')).map((b) => b._id);

/** Guests currently in house and the most recent departures, for the given physical rooms. */
export async function staysForRooms(hotelId, roomIds) {
  const fields = 'code guestName checkIn checkOut checkedInAt checkedOutAt assignedRooms adults children';
  const [inHouse, departed] = await Promise.all([
    Booking.find({ hotel: hotelId, status: 'checked_in', assignedRooms: { $in: roomIds } }).select(fields).lean(),
    Booking.find({ hotel: hotelId, status: 'checked_out', assignedRooms: { $in: roomIds }, checkedOutAt: { $ne: null } })
      .sort({ checkedOutAt: -1 })
      .limit(500)
      .select(fields)
      .lean(),
  ]);
  return { inHouse, departed };
}

/** Per-guest booking count, completed stays, lifetime spend and last stay date. */
export const statsByGuest = (guestIds) =>
  Booking.aggregate([
    { $match: { guest: { $in: guestIds } } },
    {
      $group: {
        _id: '$guest',
        bookings: { $sum: 1 },
        stays: { $sum: { $cond: [{ $in: ['$status', ['checked_out', 'checked_in']] }, 1, 0] } },
        spent: { $sum: { $subtract: ['$amountPaid', '$amountRefunded'] } },
        lastStay: { $max: { $cond: [{ $in: ['$status', ['checked_out', 'checked_in', 'confirmed']] }, '$checkIn', null] } },
      },
    },
  ]);

/**
 * Admin booking list. `status` is comma separated; `view` (arrivals, departures, in_house) narrows by date on top of
 * any explicit status filter; `from`/`to` select stays overlapping that range.
 */
export function search(hotel, q) {
  const filter = { hotel: hotel._id };
  if (q.status) filter.status = { $in: q.status.split(',').filter((s) => BOOKING_STATUSES.includes(s)) };
  if (q.from) filter.checkOut = { $gt: q.from };
  if (q.to) filter.checkIn = { $lte: q.to };
  if (q.source) filter.source = q.source;
  if (q.view) {
    const date = q.date || todayIn(hotel.timezone);
    const views = {
      arrivals: [{ checkIn: date }, ['pending_payment', 'confirmed', 'checked_in']],
      departures: [{ checkOut: date }, ['checked_in', 'checked_out']],
      in_house: [{}, ['checked_in']],
    };
    const [dates, statuses] = views[q.view];
    Object.assign(filter, dates);
    filter.status = { $in: filter.status ? filter.status.$in.filter((s) => statuses.includes(s)) : statuses };
  }
  if (q.q) {
    const rx = new RegExp(escapeRegex(q.q), 'i');
    filter.$or = [{ code: rx }, { guestName: rx }, { guestPhone: rx }, { guestEmail: rx }];
  }
  return paginate(Booking, filter, q, { sort: { checkIn: -1, createdAt: -1 }, select: '-history -nightlyRates' });
}

// ---------- writes ----------

/** Creates a booking with a fresh unique code (retries on the rare code collision). */
export async function createWithUniqueCode(doc) {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await Booking.create({ ...doc, code: bookingCode() });
    } catch (e) {
      if (e.code !== 11000 || attempt >= 4) throw e;
    }
  }
}

/**
 * Atomic state change: applies `set` (and `unset`) and appends `history` only if the booking still matches `filter`
 * (normally its id plus the status it must be in). Returns the updated booking, or null if someone else got there first.
 */
export const transition = (filter, { set, unset, history }) =>
  Booking.findOneAndUpdate(filter, { $set: set, ...(unset ? { $unset: unset } : {}), $push: { history } }, { returnDocument: 'after' });

export const pushHistory = (id, entry) => Booking.updateOne({ _id: id }, { $push: { history: entry } });

export const addPayment = (id, amount, entry) => Booking.updateOne({ _id: id }, { $inc: { amountPaid: amount }, $push: { history: entry } });

export const addRefund = (id, amount, entry) => Booking.updateOne({ _id: id }, { $inc: { amountRefunded: amount }, $push: { history: entry } });

/** Marks the rooms as given back from `fromDay`. True only for the call that flipped it, so inventory is released exactly once. */
export async function markInventoryReleased(id, fromDay) {
  const result = await Booking.updateOne({ _id: id, inventoryHeld: true }, { $set: { inventoryHeld: false, inventoryReleasedFrom: fromDay } });
  return result.modifiedCount === 1;
}
