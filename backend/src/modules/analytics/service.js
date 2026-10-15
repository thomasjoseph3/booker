import { addDays, nightsBetween, todayIn } from '../../utils/dates.js';
import { round2 } from '../../utils/misc.js';
import * as repo from './repository.js';

/** Front-desk dashboard: today's movements, occupancy for the next two weeks, 30-day revenue. */
export async function dashboard(hotel) {
  const today = todayIn(hotel.timezone);
  const horizon = nightsBetween(today, addDays(today, 14));
  const data = await repo.dashboardQueries({
    hotelId: hotel._id,
    today,
    since: new Date(Date.now() - 30 * 24 * 3600 * 1000),
    startOfToday: new Date(Date.now() - 24 * 3600 * 1000),
    horizon,
  });
  const { roomTypes, arrivals, departures, inHouse, pendingPayment, openCallbacks, callsToday, bookingsToday, money, inv, bySource, roomStatus } = data;

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

  return {
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
  };
}

/** Agent and booking performance over the last `days` days. */
export async function analytics(hotel, days) {
  const tz = hotel.timezone;
  const today = todayIn(tz);
  const pastNights = nightsBetween(addDays(today, -days), today);
  const data = await repo.analyticsQueries({
    hotelId: hotel._id,
    timezone: tz,
    since: new Date(Date.now() - days * 24 * 3600 * 1000),
    pastNights,
  });
  const { callAgg, callsByDay, callsByHour, intents, bookingAgg, bySource, byRoomType, inv, roomTypes, repeatGuests } = data;

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

  return {
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
  };
}
