import { Router } from 'express';
import { z } from 'zod';
import { requireRole } from '../../middleware/auth.js';
import { validate, validatePatch } from '../../middleware/validate.js';
import {
  BOOKING_STATUSES, Booking, Callback, CallLog, Guest, Inventory, Notification, Payment, Room, RoomType,
} from '../../models/index.js';
import { setStopSell } from '../../services/inventory.js';
import * as svc from '../../services/bookings.js';
import { textAgent } from '../../agent/index.js';
import { addDays, nightsBetween, todayIn } from '../../utils/dates.js';
import { badRequest, conflict, notFound } from '../../utils/errors.js';
import { escapeRegex, round2 } from '../../utils/misc.js';
import {
  adminCreateBookingSchema, availabilitySchema, day, modifyBookingSchema, objectId, roomSchema, roomTypeSchema,
} from '../../validation.js';

// Mounted at /api/admin/hotels/:hotelId — req.hotel is loaded and access-checked already.
const router = Router({ mergeParams: true });
const managers = requireRole('super_admin', 'hotel_admin');

const pageQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

async function paginate(model, filter, q, { sort = { createdAt: -1 }, populate, select } = {}) {
  let query = model.find(filter).sort(sort).skip((q.page - 1) * q.limit).limit(q.limit);
  if (populate) query = query.populate(...populate);
  if (select) query = query.select(select);
  const [items, total] = await Promise.all([query, model.countDocuments(filter)]);
  return { items, total, page: q.page, pages: Math.ceil(total / q.limit) };
}

// ---------- browser test call (voice agent) ----------

router.post('/voice/start', validate(z.object({ callerPhone: z.string().min(5), callerEmail: z.union([z.email(), z.literal('')]).optional() })), async (req, res) => {
  res.status(201).json(await textAgent.startCall(req.hotel, req.body));
});
router.post('/voice/turn', validate(z.object({ callId: z.string(), text: z.string().trim().min(1).max(1000) })), async (req, res) => {
  res.json(await textAgent.agentTurn(req.hotel, req.body.callId, req.body.text));
});
router.post('/voice/end', validate(z.object({ callId: z.string() })), async (req, res) => {
  res.json(await textAgent.endCall(req.hotel, req.body.callId));
});

// ---------- dashboard ----------

router.get('/dashboard', async (req, res) => {
  const hotel = req.hotel;
  const today = todayIn(hotel.timezone);
  const h = hotel._id;
  const since = new Date(Date.now() - 30 * 24 * 3600 * 1000);
  const startOfToday = new Date(Date.now() - 24 * 3600 * 1000);
  const horizon = nightsBetween(today, addDays(today, 14));

  const [roomTypes, arrivals, departures, inHouse, pendingPayment, openCallbacks, callsToday, bookingsToday, money, inv, bySource, roomStatus] = await Promise.all([
    RoomType.find({ hotel: h, active: true }).lean(),
    Booking.find({ hotel: h, checkIn: today, status: { $in: ['confirmed', 'pending_payment', 'checked_in'] } }).sort({ guestName: 1 }),
    Booking.find({ hotel: h, checkOut: today, status: { $in: ['checked_in', 'checked_out'] } }).sort({ guestName: 1 }),
    Booking.countDocuments({ hotel: h, status: 'checked_in' }),
    Booking.countDocuments({ hotel: h, status: 'pending_payment' }),
    Callback.countDocuments({ hotel: h, status: { $ne: 'done' } }),
    CallLog.countDocuments({ hotel: h, createdAt: { $gte: startOfToday } }),
    Booking.countDocuments({ hotel: h, createdAt: { $gte: startOfToday } }),
    Payment.aggregate([
      { $match: { hotel: h, status: { $in: ['paid', 'refunded'] }, createdAt: { $gte: since } } },
      { $group: { _id: '$kind', amount: { $sum: '$amount' } } },
    ]),
    Inventory.aggregate([{ $match: { hotel: h, date: { $in: horizon } } }, { $group: { _id: '$date', booked: { $sum: '$booked' } } }]),
    Booking.aggregate([{ $match: { hotel: h, createdAt: { $gte: since } } }, { $group: { _id: '$source', count: { $sum: 1 } } }]),
    Room.aggregate([{ $match: { hotel: h } }, { $group: { _id: '$status', count: { $sum: 1 } } }]),
  ]);

  const totalRooms = roomTypes.reduce((s, rt) => s + rt.totalRooms, 0);
  const bookedByDate = new Map(inv.map((r) => [r._id, r.booked]));
  const occupancy = horizon.map((date) => ({
    date,
    booked: bookedByDate.get(date) || 0,
    totalRooms,
    percent: totalRooms ? Math.round(((bookedByDate.get(date) || 0) / totalRooms) * 100) : 0,
  }));
  const collected = money.find((m) => m._id === 'charge')?.amount || 0;
  const refunded = money.find((m) => m._id === 'refund')?.amount || 0;

  res.json({
    today,
    currency: hotel.currency,
    totalRooms,
    occupancyTonight: occupancy[0],
    occupancy,
    arrivals,
    departures,
    counts: { inHouse, pendingPayment, openCallbacks, callsToday, bookingsToday },
    revenue30d: { collected: round2(collected), refunded: round2(refunded), net: round2(collected - refunded) },
    bookingsBySource30d: Object.fromEntries(bySource.map((s) => [s._id, s.count])),
    // physical rooms right now (housekeeping view); `occupancyTonight` is what is sold
    roomStatus: { available: 0, occupied: 0, cleaning: 0, out_of_service: 0, ...Object.fromEntries(roomStatus.map((s) => [s._id, s.count])) },
  });
});

// ---------- analytics ----------

router.get('/analytics', validate(z.object({ days: z.coerce.number().int().min(1).max(365).default(30) }), 'query'), async (req, res) => {
  const hotel = req.hotel;
  const h = hotel._id;
  const tz = hotel.timezone;
  const days = req.q.days;
  const since = new Date(Date.now() - days * 24 * 3600 * 1000);
  const today = todayIn(tz);
  const pastNights = nightsBetween(addDays(today, -days), today);
  const dayOf = (field) => ({ $dateToString: { format: '%Y-%m-%d', date: field, timezone: tz } });

  const [callAgg, callsByDay, callsByHour, intents, bookingAgg, bySource, byRoomType, inv, roomTypes, repeatGuests] = await Promise.all([
    CallLog.aggregate([
      { $match: { hotel: h, createdAt: { $gte: since } } },
      {
        $facet: {
          total: [{ $count: 'n' }],
          byOutcome: [{ $group: { _id: '$outcome', n: { $sum: 1 } } }],
          bySentiment: [{ $group: { _id: '$sentiment', n: { $sum: 1 } } }],
          duration: [{ $match: { durationSec: { $gt: 0 } } }, { $group: { _id: null, avg: { $avg: '$durationSec' }, total: { $sum: '$durationSec' } } }],
        },
      },
    ]),
    CallLog.aggregate([
      { $match: { hotel: h, createdAt: { $gte: since } } },
      { $group: { _id: dayOf({ $ifNull: ['$startedAt', '$createdAt'] }), calls: { $sum: 1 }, booked: { $sum: { $cond: [{ $eq: ['$outcome', 'booked'] }, 1, 0] } } } },
      { $sort: { _id: 1 } },
    ]),
    CallLog.aggregate([
      { $match: { hotel: h, createdAt: { $gte: since } } },
      { $group: { _id: { $hour: { date: { $ifNull: ['$startedAt', '$createdAt'] }, timezone: tz } }, n: { $sum: 1 } } },
    ]),
    CallLog.aggregate([
      { $match: { hotel: h, createdAt: { $gte: since }, intent: { $nin: [null, ''] } } },
      { $group: { _id: '$intent', n: { $sum: 1 } } },
      { $sort: { n: -1 } },
      { $limit: 8 },
    ]),
    Booking.aggregate([
      { $match: { hotel: h, source: 'phone_agent', createdAt: { $gte: since } } },
      {
        $group: {
          _id: '$status',
          n: { $sum: 1 },
          value: { $sum: '$total' },
          neededAdvance: { $sum: { $cond: [{ $gt: ['$advanceDue', 0] }, 1, 0] } },
          paidAdvance: { $sum: { $cond: [{ $and: [{ $gt: ['$advanceDue', 0] }, { $gt: ['$amountPaid', 0] }] }, 1, 0] } },
        },
      },
    ]),
    Booking.aggregate([
      { $match: { hotel: h, createdAt: { $gte: since }, status: { $nin: ['expired'] } } },
      {
        $group: {
          _id: '$source',
          bookings: { $sum: 1 },
          cancelled: { $sum: { $cond: [{ $eq: ['$status', 'cancelled'] }, 1, 0] } },
          revenue: { $sum: { $cond: [{ $in: ['$status', ['cancelled', 'no_show']] }, 0, '$total'] } },
          roomNights: { $sum: { $cond: [{ $in: ['$status', ['cancelled', 'no_show']] }, 0, { $multiply: ['$nights', '$roomsCount'] }] } },
        },
      },
      { $sort: { bookings: -1 } },
    ]),
    Booking.aggregate([
      { $match: { hotel: h, createdAt: { $gte: since }, status: { $nin: ['expired', 'cancelled'] } } },
      { $group: { _id: '$roomTypeName', bookings: { $sum: 1 }, revenue: { $sum: '$total' }, roomNights: { $sum: { $multiply: ['$nights', '$roomsCount'] } } } },
      { $sort: { revenue: -1 } },
    ]),
    Inventory.aggregate([{ $match: { hotel: h, date: { $in: pastNights } } }, { $group: { _id: '$date', booked: { $sum: '$booked' } } }]),
    RoomType.find({ hotel: h, active: true }).lean(),
    Booking.aggregate([
      { $match: { hotel: h, status: { $in: ['checked_out', 'checked_in', 'confirmed'] } } },
      { $group: { _id: '$guest', n: { $sum: 1 } } },
      { $group: { _id: null, guests: { $sum: 1 }, repeat: { $sum: { $cond: [{ $gt: ['$n', 1] }, 1, 0] } } } },
    ]),
  ]);

  const c = callAgg[0];
  const totalCalls = c.total[0]?.n || 0;
  const outcome = Object.fromEntries(c.byOutcome.map((o) => [o._id || 'unknown', o.n]));
  const agentStatus = Object.fromEntries(bookingAgg.map((b) => [b._id, b.n]));
  const agentCreated = bookingAgg.reduce((s, b) => s + b.n, 0);
  const settled = bookingAgg.filter((b) => b._id !== 'pending_payment'); // still inside their hold window
  const agentNeeded = settled.reduce((s, b) => s + b.neededAdvance, 0);
  const agentPaid = settled.reduce((s, b) => s + b.paidAdvance, 0);
  const agentValue = bookingAgg.filter((b) => !['expired', 'cancelled'].includes(b._id)).reduce((s, b) => s + b.value, 0);

  const totalRooms = roomTypes.reduce((s, rt) => s + rt.totalRooms, 0);
  const bookedBy = new Map(inv.map((r) => [r._id, r.booked]));
  const occupancy = pastNights.map((date) => ({ date, percent: totalRooms ? Math.round(((bookedBy.get(date) || 0) / totalRooms) * 100) : 0 }));
  const soldNights = pastNights.reduce((s, d) => s + (bookedBy.get(d) || 0), 0);
  const roomNightsAll = bySource.reduce((s, x) => s + x.roomNights, 0);
  const revenueAll = bySource.reduce((s, x) => s + x.revenue, 0);
  const hourMap = new Map(callsByHour.map((x) => [x._id, x.n]));

  res.json({
    days,
    currency: hotel.currency,
    calls: {
      total: totalCalls,
      byOutcome: outcome,
      bySentiment: Object.fromEntries(c.bySentiment.map((o) => [o._id || 'unknown', o.n])),
      avgDurationSec: Math.round(c.duration[0]?.avg || 0),
      totalTalkMinutes: Math.round((c.duration[0]?.total || 0) / 60),
      bookingConversion: totalCalls ? Math.round(((outcome.booked || 0) / totalCalls) * 100) : 0,
      byDay: callsByDay.map((d) => ({ date: d._id, calls: d.calls, booked: d.booked })),
      byHour: Array.from({ length: 24 }, (_, hour) => ({ hour, calls: hourMap.get(hour) || 0 })),
      topIntents: intents.map((i) => ({ intent: i._id, count: i.n })),
    },
    agentBookings: {
      created: agentCreated,
      byStatus: agentStatus,
      advanceRequested: agentNeeded,
      paidWithinHold: agentPaid,
      expiredUnpaid: agentStatus.expired || 0,
      paymentConversion: agentNeeded ? Math.round((agentPaid / agentNeeded) * 100) : 0,
      bookingValue: round2(agentValue),
    },
    bookings: {
      bySource: bySource.map((x) => ({ source: x._id, bookings: x.bookings, cancelled: x.cancelled, revenue: round2(x.revenue), roomNights: x.roomNights })),
      byRoomType: byRoomType.map((x) => ({ roomType: x._id, bookings: x.bookings, revenue: round2(x.revenue), roomNights: x.roomNights })),
      averageDailyRate: roomNightsAll ? round2(revenueAll / roomNightsAll) : 0,
      repeatGuestPercent: repeatGuests[0]?.guests ? Math.round((repeatGuests[0].repeat / repeatGuests[0].guests) * 100) : 0,
    },
    occupancy: {
      averagePercent: totalRooms && pastNights.length ? Math.round((soldNights / (totalRooms * pastNights.length)) * 100) : 0,
      byDay: occupancy,
    },
  });
});

// ---------- room types ----------

router.get('/room-types', async (req, res) => {
  res.json({ items: await RoomType.find({ hotel: req.hotel._id }).sort({ basePrice: 1 }) });
});

router.post('/room-types', managers, validate(roomTypeSchema), async (req, res) => {
  res.status(201).json(await RoomType.create({ ...req.body, hotel: req.hotel._id }));
});

router.patch('/room-types/:id', managers, validatePatch(roomTypeSchema), async (req, res) => {
  const rt = await RoomType.findOneAndUpdate({ _id: req.params.id, hotel: req.hotel._id }, { $set: req.body }, { returnDocument: 'after', runValidators: true });
  if (!rt) throw notFound('Room type');
  res.json(rt);
});

router.delete('/room-types/:id', managers, async (req, res) => {
  const rt = await RoomType.findOneAndUpdate({ _id: req.params.id, hotel: req.hotel._id }, { $set: { active: false } }, { returnDocument: 'after' });
  if (!rt) throw notFound('Room type');
  res.json({ ok: true, note: 'Room type deactivated; existing bookings are unaffected.' });
});

// ---------- physical rooms ----------

async function syncTotalRooms(roomTypeId) {
  const n = await Room.countDocuments({ roomType: roomTypeId, status: { $ne: 'out_of_service' } });
  await RoomType.updateOne({ _id: roomTypeId }, { $set: { totalRooms: n } });
}

router.get('/rooms', async (req, res) => {
  const filter = { hotel: req.hotel._id };
  if (req.query.status) filter.status = req.query.status;
  if (req.query.roomTypeId) filter.roomType = req.query.roomTypeId;
  const rooms = await Room.find(filter).populate('roomType', 'name code').sort({ number: 1 });
  const ids = rooms.map((r) => r._id);
  const fields = 'code guestName checkIn checkOut checkedInAt checkedOutAt assignedRooms adults children';
  const [inHouse, departed] = await Promise.all([
    Booking.find({ hotel: req.hotel._id, status: 'checked_in', assignedRooms: { $in: ids } }).select(fields).lean(),
    Booking.find({ hotel: req.hotel._id, status: 'checked_out', assignedRooms: { $in: ids }, checkedOutAt: { $ne: null } })
      .sort({ checkedOutAt: -1 }).limit(500).select(fields).lean(),
  ]);
  const current = new Map();
  for (const b of inHouse) for (const r of b.assignedRooms) current.set(String(r), b);
  const last = new Map();
  for (const b of departed) for (const r of b.assignedRooms) if (!last.has(String(r))) last.set(String(r), b);
  const brief = (b) => b && { code: b.code, guestName: b.guestName, checkIn: b.checkIn, checkOut: b.checkOut, checkedInAt: b.checkedInAt, checkedOutAt: b.checkedOutAt, adults: b.adults, children: b.children };
  res.json({
    items: rooms.map((r) => ({ ...r.toObject(), currentStay: brief(current.get(String(r._id))) ?? null, lastStay: brief(last.get(String(r._id))) ?? null })),
  });
});

router.post('/rooms', managers, validate(roomSchema), async (req, res) => {
  const { roomTypeId, ...rest } = req.body;
  if (!(await RoomType.exists({ _id: roomTypeId, hotel: req.hotel._id }))) throw notFound('Room type');
  const room = await Room.create({ ...rest, roomType: roomTypeId, hotel: req.hotel._id });
  await syncTotalRooms(roomTypeId);
  res.status(201).json(room);
});

// Front desk can update room status (cleaning -> available); managers can change everything.
router.patch('/rooms/:id', validatePatch(roomSchema), async (req, res) => {
  const { roomTypeId, ...rest } = req.body;
  if ((roomTypeId || rest.number) && !['super_admin', 'hotel_admin'].includes(req.user.role)) throw badRequest('Only managers can change room number or type');
  const room = await Room.findOne({ _id: req.params.id, hotel: req.hotel._id });
  if (!room) throw notFound('Room');
  const oldType = room.roomType;
  if (roomTypeId) {
    if (!(await RoomType.exists({ _id: roomTypeId, hotel: req.hotel._id }))) throw notFound('Room type');
    room.roomType = roomTypeId;
  }
  Object.assign(room, rest);
  await room.save();
  await syncTotalRooms(room.roomType);
  if (String(oldType) !== String(room.roomType)) await syncTotalRooms(oldType);
  res.json(room);
});

router.delete('/rooms/:id', managers, async (req, res) => {
  const room = await Room.findOneAndDelete({ _id: req.params.id, hotel: req.hotel._id, status: { $ne: 'occupied' } });
  if (!room) throw notFound('Room (or it is occupied)');
  await syncTotalRooms(room.roomType);
  res.json({ ok: true });
});

// ---------- inventory ----------

router.get('/inventory', validate(z.object({ from: day, to: day }), 'query'), async (req, res) => {
  const { from, to } = req.q;
  const dates = nightsBetween(from, addDays(to, 1));
  if (dates.length > 92) throw badRequest('Range is limited to 92 days');
  const roomTypes = await RoomType.find({ hotel: req.hotel._id, active: true }).lean();
  const rows = await Inventory.find({ hotel: req.hotel._id, date: { $in: dates } }).lean();
  const byKey = new Map(rows.map((r) => [`${r.roomType}:${r.date}`, r]));
  res.json({
    dates,
    roomTypes: roomTypes.map((rt) => ({
      roomTypeId: rt._id,
      name: rt.name,
      totalRooms: rt.totalRooms,
      days: dates.map((date) => {
        const r = byKey.get(`${rt._id}:${date}`);
        const booked = r?.booked || 0;
        return { date, booked, available: r?.closed ? 0 : Math.max(0, rt.totalRooms - booked), closed: Boolean(r?.closed) };
      }),
    })),
  });
});

router.put('/inventory/stop-sell', managers, validate(z.object({ roomTypeId: objectId, from: day, to: day, closed: z.boolean() })), async (req, res) => {
  const rt = await RoomType.findOne({ _id: req.body.roomTypeId, hotel: req.hotel._id });
  if (!rt) throw notFound('Room type');
  if (req.body.to < req.body.from) throw badRequest('`to` must be on or after `from`');
  const nights = await setStopSell(rt, req.body.from, req.body.to, req.body.closed);
  res.json({ ok: true, nights });
});

router.post('/availability', validate(availabilitySchema), async (req, res) => {
  res.json(await svc.searchAvailability(req.hotel, req.body));
});

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

// ---------- payments ----------

router.get('/payments', validate(pageQuery.extend({ status: z.string().optional(), kind: z.enum(['charge', 'refund']).optional() }), 'query'), async (req, res) => {
  const filter = { hotel: req.hotel._id };
  if (req.q.status) filter.status = { $in: req.q.status.split(',') };
  if (req.q.kind) filter.kind = req.q.kind;
  res.json(await paginate(Payment, filter, req.q, { populate: ['booking', 'code guestName'] }));
});

// Mark a manual (offline) refund as handed back to the guest.
router.post('/payments/:id/mark-refunded', async (req, res) => {
  const p = await Payment.findOneAndUpdate(
    { _id: req.params.id, hotel: req.hotel._id, kind: 'refund', status: 'refund_pending' },
    { $set: { status: 'refunded', recordedBy: req.actor.label } },
    { returnDocument: 'after' },
  );
  if (!p) throw conflict('INVALID_STATE', 'Refund not found or not pending');
  res.json(p);
});

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

// ---------- calls, callbacks, notifications ----------

router.get('/calls', validate(pageQuery.extend({ outcome: z.string().optional() }), 'query'), async (req, res) => {
  const filter = { hotel: req.hotel._id };
  if (req.q.outcome) filter.outcome = req.q.outcome;
  res.json(await paginate(CallLog, filter, req.q, { select: '-transcript', populate: ['bookings', 'code status'] }));
});

router.get('/calls/:id', async (req, res) => {
  const call = await CallLog.findOne({ _id: req.params.id, hotel: req.hotel._id }).populate('bookings', 'code status checkIn checkOut').populate('guest');
  if (!call) throw notFound('Call');
  res.json(call);
});

router.get('/callbacks', validate(pageQuery.extend({ status: z.string().optional() }), 'query'), async (req, res) => {
  const filter = { hotel: req.hotel._id };
  if (req.q.status) filter.status = { $in: req.q.status.split(',') };
  res.json(await paginate(Callback, filter, req.q, { populate: ['booking', 'code status'] }));
});

router.patch(
  '/callbacks/:id',
  validate(z.object({ status: z.enum(['open', 'in_progress', 'done']), assignedTo: z.string().max(120), notes: z.string().max(2000), priority: z.enum(['low', 'normal', 'high']) }).partial()),
  async (req, res) => {
    const cb = await Callback.findOneAndUpdate({ _id: req.params.id, hotel: req.hotel._id }, { $set: req.body }, { returnDocument: 'after' });
    if (!cb) throw notFound('Callback');
    res.json(cb);
  },
);

router.get('/notifications', validate(pageQuery, 'query'), async (req, res) => {
  res.json(await paginate(Notification, { hotel: req.hotel._id }, req.q, { populate: ['booking', 'code'] }));
});

export default router;
