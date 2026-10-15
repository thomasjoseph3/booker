import { Router } from 'express';
import { z } from 'zod';
import { validate } from '../../middleware/validate.js';
import { Booking, Callback, CallLog, Inventory, Payment, Room, RoomType } from '../../models/index.js';
import { addDays, nightsBetween, todayIn } from '../../utils/dates.js';
import { round2 } from '../../utils/misc.js';

const router = Router({ mergeParams: true });

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

export default router;
