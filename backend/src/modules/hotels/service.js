import { badRequest } from '../../utils/errors.js';
import { generateApiKey, normalizePhone, sha256 } from '../../utils/misc.js';
import * as repo from './repository.js';

/** Hotels a user may see: platform admins see all, everyone else only their own. */
export const listForUser = (user) => repo.list(user.role === 'super_admin' ? {} : { _id: { $in: user.hotels } });

export const createHotel = (data) => repo.create({ ...data, phoneNumbers: data.phoneNumbers.map(normalizePhone) });

/**
 * Applies a partial settings update. Nested objects are merged one level deep, so
 * `{ payment: { advancePercent: 40 } }` does not wipe the other payment settings.
 */
export async function updateHotel(hotel, changes, user) {
  for (const [key, value] of Object.entries(changes)) {
    if (key === 'slug' && user.role !== 'super_admin') throw badRequest('Only platform admins can change the slug');
    const current = hotel.get(key);
    const isNested =
      value && typeof value === 'object' && !Array.isArray(value) && current && typeof current === 'object' && !Array.isArray(current);
    hotel.set(key, isNested ? { ...(current.toObject?.() ?? current), ...value } : value);
  }
  if (changes.phoneNumbers) hotel.phoneNumbers = changes.phoneNumbers.map(normalizePhone);
  await hotel.save();
  return hotel;
}

/** Issues a new agent API key. The plaintext is returned once; only its hash is stored. */
export async function rotateAgentKey(hotel) {
  const key = generateApiKey(`hk_${hotel.slug.replace(/-/g, '').slice(0, 8)}`);
  await repo.setAgentKey(hotel._id, sha256(key), `${key.slice(0, 14)}…${key.slice(-4)}`);
  return key;
}
