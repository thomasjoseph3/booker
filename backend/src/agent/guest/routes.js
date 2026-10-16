import { Router } from 'express';
import { validate } from '../../middleware/validate.js';
import { searchAvailability } from '../../modules/bookings/availability.js';
import * as svc from '../../modules/bookings/service.js';
import * as callsRepo from '../../modules/calls/repository.js';
import * as calls from '../../modules/calls/service.js';
import * as hotels from '../../modules/hotels/repository.js';
import * as rooms from '../../modules/rooms/repository.js';
import { forbidden, notFound } from '../../utils/errors.js';
import { todayIn } from '../../utils/dates.js';
import { money, spokenMoney } from '../../utils/money.js';
import { normalizePhone } from '../../utils/misc.js';
import {
  availabilitySchema,
  calculateSchema,
  quoteSchema,
  callbackSchema,
  callerLookupSchema,
  callerSchema,
  callLogSchema,
  createBookingSchema,
  modifyBookingSchema,
} from '../../validation.js';
import { calculate } from '../../utils/calculator.js';
import * as offersRepo from '../../modules/offers/repository.js';
import { requireAgent, requireHotelContext } from './auth.js';
import { agentTools } from '../../mcp/tools/guest.js';
import {
  agentBookingView,
  availabilityForAgent,
  combineQuotes,
  priceStayForAgent,
  ASK_ANYTHING_ELSE,
  hotelProfileForAgent,
  paymentSentence,
  roomTypeForAgent,
  specialRatesForAgent,
} from './views.js';

/** The HTTP API the agent calls as its tools. Mounted at /api/agent. */
const router = Router();

// Tool definitions are public so the agent runtime can load them at boot.
router.get('/tools', (req, res) => res.json({ tools: agentTools }));

router.use(requireAgent);

// Master key only: map the dialed number to a property.
router.get('/resolve', async (req, res) => {
  if (req.agentScope !== 'master') throw forbidden('Master key required');
  const number = normalizePhone(String(req.query.number || ''));
  const hotel = await hotels.findActiveByPhoneNumber(number);
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
  const types = await rooms.listActiveTypes(req.hotel._id);
  res.json({ currency: req.hotel.currency, taxPercent: req.hotel.taxPercent, roomTypes: types.map(roomTypeForAgent) });
});

router.get('/special-rates', async (req, res) => {
  const types = await rooms.listActiveTypes(req.hotel._id);
  const today = todayIn(req.hotel.timezone);
  res.json(specialRatesForAgent(types, today, req.hotel.currency, await offersRepo.listActive(req.hotel._id, today)));
});

router.post('/availability', validate(availabilitySchema), async (req, res) => {
  res.json(availabilityForAgent(await searchAvailability(req.hotel, req.body)));
});

router.post('/quote', validate(quoteSchema), async (req, res) => {
  const { checkIn, checkOut, rooms: lines, ...single } = req.body;
  const wanted = lines ?? [single];
  const priced = [];
  for (const line of wanted) {
    const { roomType, ...party } = line;
    priced.push(priceStayForAgent(await searchAvailability(req.hotel, { checkIn, checkOut, ...party }), roomType, party.roomsCount ?? 1));
  }
  res.json(priced.length === 1 && !lines ? priced[0] : combineQuotes(priced));
});

router.post('/calculate', validate(calculateSchema), (req, res) => {
  try {
    const result = calculate(req.body.expression);
    res.json({ expression: req.body.expression, result, say: spokenMoney(req.hotel.currency, result) });
  } catch (e) {
    res.json({ error: e.message });
  }
});

router.post('/bookings', validate(createBookingSchema), async (req, res) => {
  const { booking, payment, paymentError } = await svc.createBooking(req.hotel, { ...req.body, source: 'phone_agent' }, req.actor);
  if (req.body.callId) {
    await callsRepo.addBookingToCall(req.hotel._id, req.body.callId, booking._id);
  }
  const sayNext =
    booking.status === 'confirmed'
      ? `Booking ${booking.code} is confirmed. Total ${money(booking.currency, booking.total)}, payable at the hotel. ${ASK_ANYTHING_ELSE}`
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

router.post(
  '/bookings/:code/cancel',
  validate(callerSchema.extend({ reason: callbackSchema.shape.reason.optional() })),
  async (req, res) => {
    const booking = await callerBooking(req);
    const {
      booking: updated,
      fee,
      refundAmount,
    } = await svc.cancelBooking(req.hotel, booking, { reason: req.body.reason || 'Cancelled by guest over phone' }, req.actor);
    res.json({
      booking: agentBookingView(updated),
      fee,
      refundAmount,
      sayNext:
        `Booking ${updated.code} is cancelled.` +
        (refundAmount > 0
          ? ` A refund of ${money(updated.currency, refundAmount)} has been initiated and usually reaches the original payment method in 5 to 7 working days.`
          : ''),
    });
  },
);

router.patch('/bookings/:code', validate(callerSchema.extend(modifyBookingSchema.shape)), async (req, res) => {
  const booking = await callerBooking(req);
  const { phone: _phone, ...changes } = req.body;
  const { booking: updated, payment, refunded } = await svc.modifyBooking(req.hotel, booking, changes, req.actor);
  let sayNext = `Booking ${updated.code} is updated: ${updated.roomsCount} x ${updated.roomTypeName}, ${updated.checkIn} to ${updated.checkOut}, total ${money(updated.currency, updated.total)}.`;
  if (payment) sayNext += ` ${paymentSentence(req.hotel, updated, payment)}`;
  if (refunded) sayNext += ` ${money(updated.currency, refunded)} will be refunded.`;
  res.json({ booking: agentBookingView(updated, payment), sayNext });
});

router.post('/bookings/:code/payment-link', validate(callerSchema), async (req, res) => {
  const booking = await callerBooking(req);
  const payment = await svc.resendPaymentLink(req.hotel, booking, req.actor);
  const fresh = await svc.findById(booking._id);
  res.json({ booking: agentBookingView(fresh, payment), sayNext: paymentSentence(req.hotel, fresh, payment) });
});

router.post('/callbacks', validate(callbackSchema), async (req, res) => {
  const callback = await calls.requestCallback(req.hotel, req.body, req.actor);
  res.status(201).json({ id: callback._id, sayNext: 'A member of our team will call you back shortly.' });
});

// Create or update a call record; transcript entries are appended.
router.post('/calls', validate(callLogSchema), async (req, res) => {
  const call = await calls.recordCall(req.hotel, req.body);
  res.json({ id: call._id, callId: call.callId });
});

export default router;
