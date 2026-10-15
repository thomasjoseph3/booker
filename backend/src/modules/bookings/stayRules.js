import { addDays, isValidDay, nightsBetween, todayIn } from '../../utils/dates.js';
import { badRequest } from '../../utils/errors.js';

const MAX_NIGHTS = 30;

/** Throws a readable error unless the dates form a bookable stay at this property. */
export function assertStayDates(hotel, checkIn, checkOut) {
  if (!isValidDay(checkIn) || !isValidDay(checkOut)) throw badRequest('Dates must be in YYYY-MM-DD format');
  if (checkOut <= checkIn) throw badRequest('Check-out must be after check-in');
  const today = todayIn(hotel.timezone);
  if (checkIn < today) throw badRequest(`Check-in date ${checkIn} is in the past (today is ${today} at the property)`);
  if (checkIn > addDays(today, 730)) throw badRequest('Bookings can be made up to 2 years in advance');
  if (nightsBetween(checkIn, checkOut).length > MAX_NIGHTS)
    throw badRequest(`Stays longer than ${MAX_NIGHTS} nights must be arranged with the front desk`);
}

/** Fewest rooms of this type the party fits in (`Infinity` when the type cannot take them at all). */
export function roomsNeededFor(roomType, adults, children) {
  if (children > 0 && roomType.maxChildren === 0) return Infinity;
  return Math.max(
    Math.ceil(adults / roomType.maxAdults),
    roomType.maxChildren ? Math.ceil(children / roomType.maxChildren) : 0,
    Math.ceil((adults + children) / roomType.maxOccupancy),
  );
}

/** Throws unless the party fits in `roomsCount` rooms of this type. */
export function assertOccupancy(roomType, adults, children, roomsCount) {
  const needed = roomsNeededFor(roomType, adults, children);
  if (needed > roomsCount) {
    throw badRequest(
      `${roomType.name} fits up to ${roomType.maxAdults} adults, ${roomType.maxChildren} children and ${roomType.maxOccupancy} guests per room; ` +
        `${adults} adults and ${children} children need at least ${needed === Infinity ? 'a different room type' : `${needed} rooms`}`,
      { roomsNeeded: needed === Infinity ? null : needed },
    );
  }
  if (roomsCount > adults) throw badRequest('Each room needs at least one adult');
}
