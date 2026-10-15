import { Guest } from '../../models/index.js';
import { escapeRegex } from '../../utils/misc.js';
import { paginate } from '../../utils/pagination.js';

export const findByPhone = (hotelId, phone) => Guest.findOne({ hotel: hotelId, phone });

export const findById = (hotelId, id) => Guest.findOne({ _id: id, hotel: hotelId });

export const update = (hotelId, id, changes) => Guest.findOneAndUpdate({ _id: id, hotel: hotelId }, { $set: changes }, { returnDocument: 'after' });

/** Paginated guest list, optionally filtered by name, phone or email. */
export function search(hotelId, text, page) {
  const filter = { hotel: hotelId };
  if (text) {
    const rx = new RegExp(escapeRegex(text), 'i');
    filter.$or = [{ name: rx }, { phone: rx }, { email: rx }];
  }
  return paginate(Guest, filter, page, { sort: { updatedAt: -1 } });
}

/** Creates the guest or refreshes their name/email. Safe against two simultaneous bookings by the same phone. */
export async function upsertByPhone(hotelId, phone, { name, email }) {
  const update = { $set: { name, ...(email ? { email } : {}) } };
  try {
    return await Guest.findOneAndUpdate({ hotel: hotelId, phone }, update, { upsert: true, returnDocument: 'after' });
  } catch (e) {
    if (e.code !== 11000) throw e; // lost an upsert race; the guest exists now
    return Guest.findOneAndUpdate({ hotel: hotelId, phone }, update, { returnDocument: 'after' });
  }
}
