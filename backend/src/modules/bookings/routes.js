import { Router } from 'express';
import { z } from 'zod';
import { validate } from '../../middleware/validate.js';
import { pageQuery } from '../../utils/pagination.js';
import { adminCreateBookingSchema, day, modifyBookingSchema, objectId } from '../../validation.js';
import * as service from './service.js';

const router = Router({ mergeParams: true });

const bookingListQuery = pageQuery.extend({
  status: z.string().optional(), // comma separated
  from: day.optional(), // stays overlapping [from, to]
  to: day.optional(),
  view: z.enum(['arrivals', 'departures', 'in_house', 'overdue']).optional(),
  date: day.optional(),
  q: z.string().max(100).optional(),
  source: z.string().optional(),
});

router.get('/bookings', validate(bookingListQuery, 'query'), async (req, res) => {
  res.json(await service.searchBookings(req.hotel, req.q));
});

router.post('/bookings', validate(adminCreateBookingSchema), async (req, res) => {
  res.status(201).json(await service.createBooking(req.hotel, req.body, req.actor));
});

const loadBooking = (req) => service.findByCode(req.hotel, req.params.code);

router.get('/bookings/:code', async (req, res) => {
  res.json(await service.bookingDetail(req.hotel, req.params.code));
});

router.patch('/bookings/:code', validate(modifyBookingSchema), async (req, res) => {
  res.json(await service.modifyBooking(req.hotel, await loadBooking(req), req.body, req.actor));
});

router.get('/bookings/:code/cancellation-quote', async (req, res) => {
  res.json(service.cancellationQuote(req.hotel, await loadBooking(req)));
});

router.post(
  '/bookings/:code/cancel',
  validate(z.object({ reason: z.string().max(1000).optional(), waiveFee: z.boolean().default(false) })),
  async (req, res) => {
    const { reason, waiveFee } = req.body;
    res.json(
      await service.cancelBooking(req.hotel, await loadBooking(req), { reason: reason || 'Cancelled by staff', waiveFee }, req.actor),
    );
  },
);

router.post('/bookings/:code/check-in', validate(z.object({ roomIds: z.array(objectId).optional() })), async (req, res) => {
  res.json(await service.checkInBooking(req.hotel, await loadBooking(req), req.body, req.actor));
});

router.post('/bookings/:code/check-out', validate(z.object({ force: z.boolean().default(false) })), async (req, res) => {
  res.json(await service.checkOutBooking(req.hotel, await loadBooking(req), req.body, req.actor));
});

router.post('/bookings/:code/no-show', async (req, res) => {
  res.json(await service.markNoShow(req.hotel, await loadBooking(req), req.actor));
});

const offlinePayment = z.object({
  amount: z.number().positive(),
  method: z.enum(['cash', 'card', 'upi', 'bank_transfer', 'other']),
  note: z.string().max(500).optional(),
});

router.post('/bookings/:code/payments', validate(offlinePayment), async (req, res) => {
  res.status(201).json(await service.recordOfflinePayment(req.hotel, await loadBooking(req), req.body, req.actor));
});

router.post('/bookings/:code/payment-link', async (req, res) => {
  res.json(await service.resendPaymentLink(req.hotel, await loadBooking(req), req.actor));
});

router.post('/bookings/:code/notes', validate(z.object({ note: z.string().min(1).max(2000) })), async (req, res) => {
  await service.addNote(req.hotel, req.params.code, req.body.note, req.actor);
  res.status(201).json({ ok: true });
});

export default router;
