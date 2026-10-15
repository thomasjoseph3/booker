import { hotelProfileForAgent } from '../guest/views.js';
import { analytics, dashboard } from '../../modules/analytics/service.js';
import { searchAvailability } from '../../modules/bookings/availability.js';
import { bookingDetail, searchBookings } from '../../modules/bookings/service.js';
import { findCall, listCallbacks, listCalls } from '../../modules/calls/service.js';
import { guestProfile, listGuests } from '../../modules/guests/service.js';
import { inventoryGrid } from '../../modules/inventory/service.js';
import { listPayments } from '../../modules/payments/service.js';
import { listRoomsWithStays, listRoomTypes } from '../../modules/rooms/service.js';
import { addDays, todayIn } from '../../utils/dates.js';
import { bookingBrief, callBrief, callbackBrief, guestBrief, paymentBrief, roomBrief } from './views.js';

/**
 * What the staff assistant can look up. All tools are read-only and work on the signed-in user's property
 * (`ctx.hotel`), through the same services the dashboard uses. Each tool returns compact JSON.
 */

const MAX_ROWS = 25;
const rows = (n) => Math.min(Math.max(Number(n) || 10, 1), MAX_ROWS);
const page = (n) => ({ page: 1, limit: rows(n) });
const day = (what) => ({ type: 'string', description: `${what}, YYYY-MM-DD` });
const BOOKING_STATUSES = 'pending_payment, confirmed, checked_in, checked_out, cancelled, expired, no_show';

const tool = (name, description, properties, required, run) => ({ name, description, properties, required, run });

export const staffTools = [
  tool(
    'get_overview',
    "Today's snapshot: arrivals, departures, guests in house, bookings awaiting payment, open callbacks, calls today, occupancy for the next 14 days, 30-day revenue and room status.",
    {},
    [],
    async ({ hotel }) => {
      const d = await dashboard(hotel);
      return {
        today: d.today,
        currency: d.currency,
        totalRooms: d.totalRooms,
        occupancyTonight: d.occupancyTonight,
        nextDaysOccupancyPercent: d.occupancy.map((o) => ({ date: o.date, percent: o.percent })),
        arrivalsToday: d.arrivals.map(bookingBrief),
        departuresToday: d.departures.map(bookingBrief),
        counts: d.counts,
        revenue30d: d.revenue30d,
        bookingsBySource30d: d.bookingsBySource30d,
        roomStatus: d.roomStatus,
      };
    },
  ),
  tool(
    'get_analytics',
    'Performance over the last N days: agent calls (outcomes, conversion, busy hours, sentiment, top intents), agent bookings and payment conversion, revenue by channel and room type, average daily rate, repeat guests, average occupancy.',
    { days: { type: 'integer', description: 'Window in days, 1-90 (default 30)' } },
    [],
    async ({ hotel }, { days }) => {
      const a = await analytics(hotel, Math.min(Math.max(Number(days) || 30, 1), 90));
      return { ...a, occupancy: { averagePercent: a.occupancy.averagePercent } }; // the per-day occupancy series is long; the average answers most questions
    },
  ),
  tool(
    'check_availability',
    'Which room types can take a party on given dates, how many rooms are free, and the price including tax and the advance due.',
    {
      checkIn: day('Check-in'),
      checkOut: day('Check-out'),
      adults: { type: 'integer' },
      children: { type: 'integer' },
      rooms: { type: 'integer', description: 'Number of rooms (default 1)' },
    },
    ['checkIn', 'checkOut'],
    async ({ hotel }, a) => {
      const r = await searchAvailability(hotel, {
        checkIn: a.checkIn,
        checkOut: a.checkOut,
        adults: a.adults || 2,
        children: a.children || 0,
        roomsCount: a.rooms || 1,
      });
      return {
        checkIn: r.checkIn,
        checkOut: r.checkOut,
        nights: r.nights,
        options: r.options.map((o) => ({
          room: o.name,
          freeRooms: o.availableRooms,
          bookable: o.bookable,
          roomsNeeded: o.roomsNeeded,
          reason: o.reason,
          total: o.quote.total,
          advanceDue: o.quote.advanceDue,
          currency: r.currency,
        })),
      };
    },
  ),
  tool(
    'get_inventory',
    'Day-by-day rooms sold, available and stop-sold per room type for a date range (max 31 days).',
    { from: day('First night'), to: day('Last night') },
    ['from', 'to'],
    async ({ hotel }, { from, to }) => {
      const limited = to > addDays(from, 30) ? addDays(from, 30) : to;
      return inventoryGrid(hotel, { from, to: limited });
    },
  ),
  tool(
    'list_bookings',
    `Find bookings. Filters: status (comma separated of ${BOOKING_STATUSES}), view (arrivals, departures or in_house, for a given date), a stay date range, source (phone_agent, website, admin, walk_in), or free text (code, guest name, phone, email).`,
    {
      status: { type: 'string' },
      view: { type: 'string', enum: ['arrivals', 'departures', 'in_house'] },
      date: day('Date for the view (default today)'),
      from: day('Stays overlapping from'),
      to: day('Stays overlapping to'),
      source: { type: 'string' },
      query: { type: 'string', description: 'Booking code, guest name, phone or email' },
      limit: { type: 'integer', description: `Max ${MAX_ROWS}` },
    },
    [],
    async ({ hotel }, a) => {
      const result = await searchBookings(hotel, { ...a, q: a.query, ...page(a.limit) });
      return { total: result.total, showing: result.items.length, bookings: result.items.map(bookingBrief) };
    },
  ),
  tool(
    'get_booking',
    'Everything about one booking: stay, guest, payments, messages sent, calls, cancellation terms and the latest history.',
    { code: { type: 'string', description: 'Booking code, e.g. BK7F3K9Q' } },
    ['code'],
    async ({ hotel }, { code }) => {
      const d = await bookingDetail(hotel, code);
      const b = d.booking.toObject();
      return {
        booking: bookingBrief(b),
        specialRequests: b.specialRequests,
        guest: d.booking.guest && {
          name: d.booking.guest.name,
          phone: d.booking.guest.phone,
          email: d.booking.guest.email,
          vip: d.booking.guest.vip,
        },
        assignedRooms: (b.assignedRooms || []).map((r) => r.number),
        payments: d.payments.map(paymentBrief),
        messages: d.notifications.map((n) => ({
          channel: n.channel,
          template: n.template,
          status: n.status,
          error: n.error,
          at: n.createdAt,
        })),
        calls: d.calls.map((c) => ({ id: String(c._id), outcome: c.outcome, summary: c.summary })),
        cancellationIfCancelledNow: d.cancellationQuote,
        recentHistory: (b.history || []).slice(-8).map((h) => ({ at: h.at, action: h.action, by: h.by, note: h.note })),
      };
    },
  ),
  tool('list_room_types', 'Room types with price, capacity and how many rooms of each exist.', {}, [], async ({ hotel }) => {
    const types = await listRoomTypes(hotel);
    return types.map((t) => ({
      name: t.name,
      active: t.active,
      basePrice: t.basePrice,
      weekendPrice: t.weekendPrice,
      totalRooms: t.totalRooms,
      maxAdults: t.maxAdults,
      maxChildren: t.maxChildren,
      view: t.view,
      bedType: t.bedType,
    }));
  }),
  tool(
    'list_rooms',
    'Physical rooms with their status (available, occupied, cleaning, out_of_service) and the guest currently in them.',
    { status: { type: 'string', enum: ['available', 'occupied', 'cleaning', 'out_of_service'] } },
    [],
    async ({ hotel }, { status }) => (await listRoomsWithStays(hotel, { status })).map(roomBrief),
  ),
  tool(
    'list_callbacks',
    'The queue of tasks for staff: agent hand-offs, failed refunds, undeliverable messages.',
    {
      status: { type: 'string', description: 'open, in_progress or done; comma separated (default open and in_progress)' },
      limit: { type: 'integer' },
    },
    [],
    async ({ hotel }, { status, limit }) => {
      const r = await listCallbacks(hotel._id, { status: status || 'open,in_progress' }, page(limit));
      return { total: r.total, callbacks: r.items.map(callbackBrief) };
    },
  ),
  tool(
    'list_calls',
    'Recent calls handled by the guest-facing AI agent, with outcome and summary.',
    {
      outcome: { type: 'string', enum: ['booked', 'cancelled', 'modified', 'inquiry', 'callback_requested', 'abandoned', 'other'] },
      limit: { type: 'integer' },
    },
    [],
    async ({ hotel }, { outcome, limit }) => {
      const r = await listCalls(hotel._id, { outcome }, page(limit));
      return { total: r.total, calls: r.items.map(callBrief) };
    },
  ),
  tool(
    'get_call',
    'One AI call in detail: summary plus the conversation and the tools the agent used (useful to see what went wrong).',
    { id: { type: 'string', description: 'Call id from list_calls' } },
    ['id'],
    async ({ hotel }, { id }) => {
      const call = await findCall(hotel._id, id);
      if (!call) return { error: 'Call not found' };
      const lines = call.transcript.map((t) => `${t.role}: ${t.text}`);
      return { ...callBrief(call), model: call.model, conversation: lines.slice(-60) };
    },
  ),
  tool(
    'list_payments',
    'Payments and refunds, newest first. Useful for pending refunds (status refund_pending) or unpaid links (status created).',
    {
      status: { type: 'string', description: 'created, paid, expired, cancelled, failed, refund_pending, refunded; comma separated' },
      kind: { type: 'string', enum: ['charge', 'refund'] },
      limit: { type: 'integer' },
    },
    [],
    async ({ hotel }, { status, kind, limit }) => {
      const r = await listPayments(hotel._id, { status, kind }, page(limit));
      return { total: r.total, payments: r.items.map(paymentBrief) };
    },
  ),
  tool(
    'search_guests',
    'Find guests by name, phone or email, with their booking count and lifetime spend.',
    { query: { type: 'string' }, limit: { type: 'integer' } },
    [],
    async ({ hotel }, { query, limit }) => {
      const r = await listGuests(hotel, query, page(limit));
      return { total: r.total, guests: r.items.map(guestBrief) };
    },
  ),
  tool(
    'get_guest',
    "One guest's profile with their bookings and calls.",
    { id: { type: 'string', description: 'Guest id from search_guests' } },
    ['id'],
    async ({ hotel }, { id }) => {
      const g = await guestProfile(hotel, id);
      return {
        guest: { name: g.guest.name, phone: g.guest.phone, email: g.guest.email, vip: g.guest.vip, notes: g.guest.notes },
        bookings: g.bookings.map(bookingBrief),
        calls: g.calls.map(callBrief),
      };
    },
  ),
  tool(
    'get_property_info',
    "The property's facts and policies: address, times, amenities, payment, cancellation and FAQs.",
    {},
    [],
    async ({ hotel }) => ({ ...hotelProfileForAgent(hotel), todayAtProperty: todayIn(hotel.timezone) }),
  ),
];

const byName = new Map(staffTools.map((t) => [t.name, t]));

/** Gemini `functionDeclarations` for the staff tools. */
export const staffFunctionDeclarations = staffTools.map((t) => ({
  name: t.name,
  description: t.description,
  ...(Object.keys(t.properties).length ? { parameters: { type: 'object', properties: t.properties, required: t.required } } : {}),
}));

/** Runs one tool for a hotel and user. Never throws: errors come back as `{ error }` so the model can explain or retry. */
export async function runStaffTool(ctx, name, args = {}) {
  const found = byName.get(name);
  if (!found) return { error: `Unknown tool ${name}` };
  try {
    return await found.run(ctx, args);
  } catch (e) {
    return { error: e.message, details: e.details };
  }
}
