import { nightsBetween } from '../../utils/dates.js';
import { availabilityFor } from '../inventory/service.js';
import * as rooms from '../rooms/repository.js';
import { quoteStay } from './pricing.js';
import { assertStayDates, roomsNeededFor } from './stayRules.js';

/**
 * Which room types can take this party on these dates, with prices. Bookable options come first,
 * cheapest first. Used by the admin, the agent and the website.
 */
export async function searchAvailability(hotel, { checkIn, checkOut, adults = 1, children = 0, roomsCount = 1 }) {
  assertStayDates(hotel, checkIn, checkOut);
  const roomTypes = await rooms.listActiveTypes(hotel._id);
  const available = await availabilityFor(roomTypes, checkIn, checkOut);
  const options = roomTypes.map((rt) => {
    const needed = roomsNeededFor(rt, adults, children);
    const fits = Number.isFinite(needed);
    const rooms = fits ? Math.max(roomsCount, needed) : roomsCount;
    const availableRooms = available.get(String(rt._id));
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
