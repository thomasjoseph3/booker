import { Booking, Callback, CallLog, Inventory, Payment, Room, RoomType } from '../../models/index.js';

// Read-only aggregations behind the dashboard and the analytics page.

/** Raw numbers for the dashboard: today's arrivals and departures, counters, 30-day money, near-term sold rooms. */
export async function dashboardQueries({ hotelId: h, today, since, startOfToday, horizon }) {
  const [
    roomTypes,
    arrivals,
    departures,
    inHouse,
    pendingPayment,
    openCallbacks,
    callsToday,
    bookingsToday,
    money,
    inv,
    bySource,
    roomStatus,
  ] = await Promise.all([
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
  return {
    roomTypes,
    arrivals,
    departures,
    inHouse,
    pendingPayment,
    openCallbacks,
    callsToday,
    bookingsToday,
    money,
    inv,
    bySource,
    roomStatus,
  };
}

/** Raw numbers for the analytics page: calls, agent bookings, sources, room types, occupancy history, repeat guests. */
export async function analyticsQueries({ hotelId: h, timezone: tz, since, pastNights }) {
  const dayOf = (field) => ({ $dateToString: { format: '%Y-%m-%d', date: field, timezone: tz } });

  const [callAgg, callsByDay, callsByHour, intents, bookingAgg, bySource, byRoomType, inv, roomTypes, repeatGuests] = await Promise.all([
    CallLog.aggregate([
      { $match: { hotel: h, createdAt: { $gte: since } } },
      {
        $facet: {
          total: [{ $count: 'n' }],
          byOutcome: [{ $group: { _id: '$outcome', n: { $sum: 1 } } }],
          bySentiment: [{ $group: { _id: '$sentiment', n: { $sum: 1 } } }],
          duration: [
            { $match: { durationSec: { $gt: 0 } } },
            { $group: { _id: null, avg: { $avg: '$durationSec' }, total: { $sum: '$durationSec' } } },
          ],
        },
      },
    ]),
    CallLog.aggregate([
      { $match: { hotel: h, createdAt: { $gte: since } } },
      {
        $group: {
          _id: dayOf({ $ifNull: ['$startedAt', '$createdAt'] }),
          calls: { $sum: 1 },
          booked: { $sum: { $cond: [{ $eq: ['$outcome', 'booked'] }, 1, 0] } },
        },
      },
      { $sort: { _id: 1 } },
    ]),
    CallLog.aggregate([
      { $match: { hotel: h, createdAt: { $gte: since } } },
      { $group: { _id: { $hour: { date: { $ifNull: ['$startedAt', '$createdAt'] }, timezone: tz } }, n: { $sum: 1 } } },
    ]),
    CallLog.aggregate([
      { $match: { hotel: h, createdAt: { $gte: since }, intent: { $nin: [null, ''] } } },
      { $group: { _id: '$intent', n: { $sum: 1 } } },
      { $sort: { n: -1, _id: 1 } },
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
      { $sort: { bookings: -1, _id: 1 } },
    ]),
    Booking.aggregate([
      { $match: { hotel: h, createdAt: { $gte: since }, status: { $nin: ['expired', 'cancelled'] } } },
      {
        $group: {
          _id: '$roomTypeName',
          bookings: { $sum: 1 },
          revenue: { $sum: '$total' },
          roomNights: { $sum: { $multiply: ['$nights', '$roomsCount'] } },
        },
      },
      { $sort: { revenue: -1, _id: 1 } },
    ]),
    Inventory.aggregate([{ $match: { hotel: h, date: { $in: pastNights } } }, { $group: { _id: '$date', booked: { $sum: '$booked' } } }]),
    RoomType.find({ hotel: h, active: true }).lean(),
    Booking.aggregate([
      { $match: { hotel: h, status: { $in: ['checked_out', 'checked_in', 'confirmed'] } } },
      { $group: { _id: '$guest', n: { $sum: 1 } } },
      { $group: { _id: null, guests: { $sum: 1 }, repeat: { $sum: { $cond: [{ $gt: ['$n', 1] }, 1, 0] } } } },
    ]),
  ]);
  return { callAgg, callsByDay, callsByHour, intents, bookingAgg, bySource, byRoomType, inv, roomTypes, repeatGuests };
}
