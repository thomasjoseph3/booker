import { Router } from 'express';
import { z } from 'zod';
import { validate } from '../../middleware/validate.js';
import { Booking, CallLog, Guest } from '../../models/index.js';
import { notFound } from '../../utils/errors.js';
import { escapeRegex, round2 } from '../../utils/misc.js';
import { pageQuery, paginate } from '../../utils/pagination.js';

const router = Router({ mergeParams: true });

// ---------- guests ----------

router.get('/guests', validate(pageQuery.extend({ q: z.string().max(100).optional() }), 'query'), async (req, res) => {
  const filter = { hotel: req.hotel._id };
  if (req.q.q) {
    const rx = new RegExp(escapeRegex(req.q.q), 'i');
    filter.$or = [{ name: rx }, { phone: rx }, { email: rx }];
  }
  const page = await paginate(Guest, filter, req.q, { sort: { updatedAt: -1 } });
  const stats = await Booking.aggregate([
    { $match: { guest: { $in: page.items.map((g) => g._id) } } },
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
  const byGuest = new Map(stats.map((s) => [String(s._id), s]));
  page.items = page.items.map((g) => {
    const st = byGuest.get(String(g._id)) || {};
    return { ...g.toObject(), bookings: st.bookings || 0, stays: st.stays || 0, spent: round2(st.spent || 0), lastStay: st.lastStay || null };
  });
  res.json(page);
});

router.get('/guests/:id', async (req, res) => {
  const guest = await Guest.findOne({ _id: req.params.id, hotel: req.hotel._id });
  if (!guest) throw notFound('Guest');
  const [bookings, calls] = await Promise.all([
    Booking.find({ guest: guest._id }).select('-history -nightlyRates').sort({ checkIn: -1 }),
    CallLog.find({ hotel: req.hotel._id, $or: [{ guest: guest._id }, { fromNumber: guest.phone }] }).select('-transcript').sort({ createdAt: -1 }).limit(50),
  ]);
  res.json({ guest, bookings, calls });
});

router.patch('/guests/:id', validate(z.object({ name: z.string().min(1).max(120), email: z.email(), notes: z.string().max(2000), vip: z.boolean() }).partial()), async (req, res) => {
  const guest = await Guest.findOneAndUpdate({ _id: req.params.id, hotel: req.hotel._id }, { $set: req.body }, { returnDocument: 'after' });
  if (!guest) throw notFound('Guest');
  res.json(guest);
});

export default router;
