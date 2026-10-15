import { Router } from 'express';
import { Hotel, RoomType } from '../../models/index.js';
import { notFound } from '../../utils/errors.js';

// Unauthenticated, guest-facing property info for the public website.
const router = Router();

router.get('/hotels/:slug', async (req, res) => {
  const hotel = await Hotel.findOne({ slug: req.params.slug.toLowerCase(), active: true }).lean();
  if (!hotel) throw notFound('Property');
  const rooms = await RoomType.find({ hotel: hotel._id, active: true }).sort({ basePrice: 1 }).lean();
  res.json({
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
    roomTypes: rooms.map((r) => ({
      id: r._id, name: r.name, description: r.description, bedType: r.bedType, sizeSqft: r.sizeSqft, view: r.view,
      maxAdults: r.maxAdults, maxChildren: r.maxChildren, amenities: r.amenities, images: r.images, fromPrice: r.basePrice,
    })),
  });
});

export default router;
