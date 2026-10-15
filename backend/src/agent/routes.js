import { Router } from 'express';
import { validate } from '../middleware/validate.js';
import { Booking, Callback, CallLog, Guest, Hotel, RoomType } from '../models/index.js';
import * as svc from '../services/bookings.js';
import { forbidden, notFound } from '../utils/errors.js';
import { money } from '../utils/money.js';
import { normalizePhone } from '../utils/misc.js';
import {
  availabilitySchema, callbackSchema, callerLookupSchema, callerSchema, callLogSchema, createBookingSchema, modifyBookingSchema,
} from '../validation.js';
import { requireAgent, requireHotelContext } from './auth.js';
import { agentTools } from './tools.js';
import { agentBookingView, hotelProfileForAgent, paymentSentence } from './views.js';

/** The HTTP API the agent calls as its tools. Mounted at /api/agent. */
const router = Router();

// Tool definitions are public so the agent runtime can load them at boot.
router.get('/tools', (req, res) => res.json({ tools: agentTools }));

router.use(requireAgent);

// Master key only: map the dialed number to a property.
router.get('/resolve', async (req, res) => {
  if (req.agentScope !== 'master') throw forbidden('Master key required');
  const number = normalizePhone(String(req.query.number || ''));
  const hotel = await Hotel.findOne({ phoneNumbers: number, active: true });
  if (!hotel) throw notFound('Property for this number');
  res.json({ hotelId: hotel._id, name: hotel.name, greeting: hotel.agent?.greeting, language: hotel.agent?.language });
});

router.use(requireHotelContext);

async function callerBooking(req) {
  const [booking] = await svc.findForCaller(req.hotel, { code: req.params.code, phone: req.body?.phone ?? req.q?.phone });
  return booking;
}

router.get('/hotel', (req, res) => res.json(hotelProfileForAgent(req.hotel)));

router.get('/room-types', async (req, res) => {
  const types = await RoomType.find({ hotel: req.hotel._id, active: true }).select('-hotel -__v -createdAt -updatedAt').lean();
  res.json({ currency: req.hotel.currency, taxPercent: req.hotel.taxPercent, roomTypes: types });
});

router.post('/availability', validate(availabilitySchema), async (req, res) => {
  res.json(await svc.searchAvailability(req.hotel, req.body));
});

router.post('/bookings', validate(createBookingSchema), async (req, res) => {
  const { booking, payment, paymentError } = await svc.createBooking(req.hotel, { ...req.body, source: 'phone_agent' }, req.actor);
  if (req.body.callId) {
    await CallLog.updateOne({ hotel: req.hotel._id, callId: req.body.callId }, { $addToSet: { bookings: booking._id } });
  }
  const sayNext = booking.status === 'confirmed'
    ? `Booking ${booking.code} is confirmed. Total ${money(booking.currency, booking.total)}, payable at the hotel.`
    : paymentError
      ? `The room is on hold as ${booking.code}, but the payment link could not be sent (${paymentError}). Try resending the payment link, or offer a callback from staff.`
      : paymentSentence(req.hotel, booking, payment);
  res.status(201).json({ booking: agentBookingView(booking, payment), sayNext });
});

router.get('/bookings', validate(callerLookupSchema, 'query'), async (req, res) => {
  const bookings = await svc.findForCaller(req.hotel, req.q);
  const views = await Promise.all(bookings.map(async (b) => agentBookingView(b, await svc.latestOpenPayment(b))));
  res.json({ bookings: views });
});

router.get('/bookings/:code/cancellation-quote', validate(callerSchema, 'query'), async (req, res) => {
  const booking = await callerBooking(req);
  res.json({ code: booking.code, ...svc.cancellationQuote(req.hotel, booking) });
});

router.post('/bookings/:code/cancel', validate(callerSchema.extend({ reason: callbackSchema.shape.reason.optional() })), async (req, res) => {
  const booking = await callerBooking(req);
  const { booking: updated, fee, refundAmount } = await svc.cancelBooking(req.hotel, booking, { reason: req.body.reason || 'Cancelled by guest over phone' }, req.actor);
  res.json({
    booking: agentBookingView(updated),
    fee,
    refundAmount,
    sayNext: `Booking ${updated.code} is cancelled.` + (refundAmount > 0 ? ` A refund of ${money(updated.currency, refundAmount)} has been initiated and usually reaches the original payment method in 5 to 7 working days.` : ''),
  });
});

router.patch('/bookings/:code', validate(callerSchema.extend(modifyBookingSchema.shape)), async (req, res) => {
  const booking = await callerBooking(req);
  const { phone, ...changes } = req.body;
  const { booking: updated, payment, refunded } = await svc.modifyBooking(req.hotel, booking, changes, req.actor);
  let sayNext = `Booking ${updated.code} is updated: ${updated.roomsCount} x ${updated.roomTypeName}, ${updated.checkIn} to ${updated.checkOut}, total ${money(updated.currency, updated.total)}.`;
  if (payment) sayNext += ` ${paymentSentence(req.hotel, updated, payment)}`;
  if (refunded) sayNext += ` ${money(updated.currency, refunded)} will be refunded.`;
  res.json({ booking: agentBookingView(updated, payment), sayNext });
});

router.post('/bookings/:code/payment-link', validate(callerSchema), async (req, res) => {
  const booking = await callerBooking(req);
  const payment = await svc.resendPaymentLink(req.hotel, booking, req.actor);
  const fresh = await Booking.findById(booking._id);
  res.json({ booking: agentBookingView(fresh, payment), sayNext: paymentSentence(req.hotel, fresh, payment) });
});

router.post('/callbacks', validate(callbackSchema), async (req, res) => {
  const { bookingCode, ...rest } = req.body;
  const booking = bookingCode ? await Booking.findOne({ hotel: req.hotel._id, code: bookingCode.toUpperCase() }) : null;
  const cb = await Callback.create({ ...rest, phone: normalizePhone(rest.phone), hotel: req.hotel._id, booking: booking?._id, createdBy: req.actor.label });
  res.status(201).json({ id: cb._id, sayNext: 'A member of our team will call you back shortly.' });
});

// Create or update a call record; transcript entries are appended.
router.post('/calls', validate(callLogSchema), async (req, res) => {
  const { callId, transcript, bookingCodes, ...fields } = req.body;
  const update = { $set: fields, $setOnInsert: { hotel: req.hotel._id, callId } };
  if (transcript?.length) update.$push = { transcript: { $each: transcript.map((t) => ({ ...t, at: t.at || new Date() })) } };
  if (bookingCodes?.length) {
    const ids = await Booking.find({ hotel: req.hotel._id, code: { $in: bookingCodes.map((c) => c.toUpperCase()) } }).distinct('_id');
    update.$addToSet = { bookings: { $each: ids } };
  }
  if (fields.fromNumber) {
    const guest = await Guest.findOne({ hotel: req.hotel._id, phone: normalizePhone(fields.fromNumber) });
    if (guest) update.$set.guest = guest._id;
  }
  const call = await CallLog.findOneAndUpdate({ hotel: req.hotel._id, callId }, update, { upsert: true, returnDocument: 'after' });
  res.json({ id: call._id, callId: call.callId });
});

export default router;
