import { Router } from 'express';
import { z } from 'zod';
import { validate } from '../../middleware/validate.js';
import { BOOKING_STATUSES, Booking, CallLog, Notification, Payment } from '../../models/index.js';
import * as svc from '../bookings/service.js';
import { todayIn } from '../../utils/dates.js';
import { escapeRegex } from '../../utils/misc.js';
import { pageQuery, paginate } from '../../utils/pagination.js';
import { adminCreateBookingSchema, day, modifyBookingSchema, objectId } from '../../validation.js';

const router = Router({ mergeParams: true });

// ---------- bookings ----------

const bookingListQuery = pageQuery.extend({
  status: z.string().optional(), // comma separated
  from: day.optional(), // stays overlapping [from, to]
  to: day.optional(),
  view: z.enum(['arrivals', 'departures', 'in_house']).optional(),
  date: day.optional(),
  q: z.string().max(100).optional(),
  source: z.string().optional(),
});

router.get('/bookings', validate(bookingListQuery, 'query'), async (req, res) => {
  const q = req.q;
  const filter = { hotel: req.hotel._id };
  if (q.status) {
    const statuses = q.status.split(',').filter((s) => BOOKING_STATUSES.includes(s));
    filter.status = { $in: statuses };
  }
  if (q.from) filter.checkOut = { $gt: q.from };
  if (q.to) filter.checkIn = { $lte: q.to };
  if (q.source) filter.source = q.source;
  if (q.view) {
    // A view narrows by date; an explicit status filter still applies on top of it.
    const date = q.date || todayIn(req.hotel.timezone);
    const views = {
      arrivals: [{ checkIn: date }, ['pending_payment', 'confirmed', 'checked_in']],
      departures: [{ checkOut: date }, ['checked_in', 'checked_out']],
      in_house: [{}, ['checked_in']],
    };
    const [dates, statuses] = views[q.view];
    Object.assign(filter, dates);
    const allowed = filter.status ? filter.status.$in.filter((s) => statuses.includes(s)) : statuses;
    filter.status = { $in: allowed };
  }
  if (q.q) {
    const rx = new RegExp(escapeRegex(q.q), 'i');
    filter.$or = [{ code: rx }, { guestName: rx }, { guestPhone: rx }, { guestEmail: rx }];
  }
  res.json(await paginate(Booking, filter, q, { sort: { checkIn: -1, createdAt: -1 }, select: '-history -nightlyRates' }));
});

router.post('/bookings', validate(adminCreateBookingSchema), async (req, res) => {
  const result = await svc.createBooking(req.hotel, req.body, req.actor);
  res.status(201).json(result);
});

async function loadBooking(req) {
  return svc.findByCode(req.hotel, req.params.code);
}

router.get('/bookings/:code', async (req, res) => {
  const booking = await (await loadBooking(req)).populate([
    { path: 'assignedRooms', select: 'number floor' },
    { path: 'guest' },
  ]);
  const [payments, notifications, calls] = await Promise.all([
    Payment.find({ booking: booking._id }).sort({ createdAt: 1 }),
    Notification.find({ booking: booking._id }).sort({ createdAt: 1 }),
    CallLog.find({ bookings: booking._id }).select('callId fromNumber summary outcome createdAt'),
  ]);
  res.json({ booking, payments, notifications, calls, cancellationQuote: svc.cancellationQuote(req.hotel, booking) });
});

router.patch('/bookings/:code', validate(modifyBookingSchema), async (req, res) => {
  res.json(await svc.modifyBooking(req.hotel, await loadBooking(req), req.body, req.actor));
});

router.get('/bookings/:code/cancellation-quote', async (req, res) => {
  res.json(svc.cancellationQuote(req.hotel, await loadBooking(req)));
});

router.post('/bookings/:code/cancel', validate(z.object({ reason: z.string().max(1000).optional(), waiveFee: z.boolean().default(false) })), async (req, res) => {
  res.json(await svc.cancelBooking(req.hotel, await loadBooking(req), { reason: req.body.reason || 'Cancelled by staff', waiveFee: req.body.waiveFee }, req.actor));
});

router.post('/bookings/:code/check-in', validate(z.object({ roomIds: z.array(objectId).optional() })), async (req, res) => {
  res.json(await svc.checkInBooking(req.hotel, await loadBooking(req), req.body, req.actor));
});

router.post('/bookings/:code/check-out', validate(z.object({ force: z.boolean().default(false) })), async (req, res) => {
  res.json(await svc.checkOutBooking(req.hotel, await loadBooking(req), req.body, req.actor));
});

router.post('/bookings/:code/no-show', async (req, res) => {
  res.json(await svc.markNoShow(req.hotel, await loadBooking(req), req.actor));
});

router.post(
  '/bookings/:code/payments',
  validate(z.object({ amount: z.number().positive(), method: z.enum(['cash', 'card', 'upi', 'bank_transfer', 'other']), note: z.string().max(500).optional() })),
  async (req, res) => {
    res.status(201).json(await svc.recordOfflinePayment(req.hotel, await loadBooking(req), req.body, req.actor));
  },
);

router.post('/bookings/:code/payment-link', async (req, res) => {
  res.json(await svc.resendPaymentLink(req.hotel, await loadBooking(req), req.actor));
});

router.post('/bookings/:code/notes', validate(z.object({ note: z.string().min(1).max(2000) })), async (req, res) => {
  const booking = await loadBooking(req);
  await Booking.updateOne({ _id: booking._id }, { $push: { history: { at: new Date(), action: 'note', by: req.actor.label, note: req.body.note } } });
  res.status(201).json({ ok: true });
});

export default router;
