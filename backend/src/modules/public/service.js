import { notFound } from '../../utils/errors.js';
import * as hotels from '../hotels/repository.js';
import * as rooms from '../rooms/repository.js';

/** What the public website may show about a property (no internal ids beyond the room type id). */
export async function propertyProfile(slug) {
  const hotel = await hotels.findActiveBySlug(slug);
  if (!hotel) throw notFound('Property');
  const roomTypes = await rooms.listActiveTypesByPrice(hotel._id);
  return {
    slug: hotel.slug,
    name: hotel.name,
    propertyType: hotel.propertyType,
    description: hotel.description,
    starRating: hotel.starRating,
    address: hotel.address,
    contact: { phone: hotel.contact?.phone, email: hotel.contact?.email },
    currency: hotel.currency,
    checkInTime: hotel.checkInTime,
    checkOutTime: hotel.checkOutTime,
    amenities: hotel.amenities,
    faqs: hotel.faqs,
    roomTypes: roomTypes.map((r) => ({
      id: r._id,
      name: r.name,
      description: r.description,
      bedType: r.bedType,
      sizeSqft: r.sizeSqft,
      view: r.view,
      maxAdults: r.maxAdults,
      maxChildren: r.maxChildren,
      amenities: r.amenities,
      images: r.images,
      fromPrice: r.basePrice,
    })),
  };
}
