import { z } from 'zod';
import { analytics, dashboard } from '../../modules/analytics/service.js';
import { searchAvailability } from '../../modules/bookings/availability.js';
import { bookingDetail, searchBookings } from '../../modules/bookings/service.js';
import { findCall, listCallbacks, listCalls } from '../../modules/calls/service.js';
import { guestProfile, listGuests } from '../../modules/guests/service.js';
import { inventoryGrid } from '../../modules/inventory/service.js';
import { listPayments } from '../../modules/payments/service.js';
import { listRoomsWithStays, listRoomTypes } from '../../modules/rooms/service.js';
import { addDays, todayIn } from '../../utils/dates.js';
import { hotelProfileForAgent } from '../../agent/guest/views.js';
import { bookingBrief, callBrief, callbackBrief, guestBrief, paymentBrief, roomBrief } from './staffViews.js';

/**
 * What the staff assistant can look up. All tools are read-only and work on the signed-in user's property
 * (`ctx.hotel`), through the same services the dashboard uses. Each returns compact JSON.
 *
 * Defined here in the MCP code. A spec is `{ name, description, schema (zod), run(ctx, args) }`. The MCP server
 * (mcp/servers.js) publishes them and runs them through `runStaffTool`; the staff assistant learns them from the server.
 */

const MAX_ROWS = 25;
const rows = (n) => Math.min(Math.max(Number(n) || 10, 1), MAX_ROWS);
const page = (n) => ({ page: 1, limit: rows(n) });
const day = (what) => z.string().describe(`${what}, YYYY-MM-DD`);
const limit = z.coerce.number().int().optional().describe(`Max rows, up to ${MAX_ROWS}`);
const BOOKING_STATUSES = 'pending_payment, confirmed, checked_in, checked_out, cancelled, expired, no_show';

const spec = (name, description, schema, run) => ({ name, description, schema, run });

export const staffToolSpecs = [
  spec(
    'get_overview',
    "Today's snapshot: arrivals, departures, guests in house, bookings awaiting payment, open callbacks, calls today, occupancy for the next 14 days, 30-day revenue and room status.",
    z.object({}),
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
  spec(
    'get_analytics',
    'Performance over the last N days: agent calls (outcomes, conversion, busy hours, sentiment, languages, top intents), agent bookings and payment conversion, revenue by channel and room type, average daily rate, repeat guests, average occupancy.',
    z.object({ days: z.coerce.number().int().optional().describe('Window in days, 1-90 (default 30)') }),
    async ({ hotel }, { days }) => {
      const a = await analytics(hotel, Math.min(Math.max(Number(days) || 30, 1), 90));
      return { ...a, occupancy: { averagePercent: a.occupancy.averagePercent } }; // the per-day occupancy series is long; the average answers most questions
    },
  ),
  spec(
    'check_availability',
    'Which room types can take a party on given dates, how many rooms are free, and the price including tax and the advance due.',
    z.object({
      checkIn: day('Check-in'),
      checkOut: day('Check-out'),
      adults: z.coerce.number().int().optional(),
      children: z.coerce.number().int().optional(),
      rooms: z.coerce.number().int().optional().describe('Number of rooms (default 1)'),
    }),
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
  spec(
    'get_inventory',
    'Day-by-day rooms sold, available and stop-sold per room type for a date range (max 31 days).',
    z.object({ from: day('First night'), to: day('Last night') }),
    async ({ hotel }, { from, to }) => inventoryGrid(hotel, { from, to: to > addDays(from, 30) ? addDays(from, 30) : to }),
  ),
  spec(
    'list_bookings',
    `Find bookings. Filters: status (comma separated of ${BOOKING_STATUSES}), view (arrivals, departures or in_house, for a given date), a stay date range, source (phone_agent, website, admin, walk_in), or free text (code, guest name, phone, email).`,
    z.object({
      status: z.string().optional(),
      view: z.enum(['arrivals', 'departures', 'in_house']).optional(),
      date: day('Date for the view (default today)').optional(),
      from: day('Stays overlapping from').optional(),
      to: day('Stays overlapping to').optional(),
      source: z.string().optional(),
      query: z.string().optional().describe('Booking code, guest name, phone or email'),
      limit,
    }),
    async ({ hotel }, a) => {
      const result = await searchBookings(hotel, { ...a, q: a.query, ...page(a.limit) });
      return { total: result.total, showing: result.items.length, bookings: result.items.map(bookingBrief) };
    },
  ),
  spec(
    'get_booking',
    'Everything about one booking: stay, guest, payments, messages sent, calls, cancellation terms and the latest history.',
    z.object({ code: z.string().describe('Booking code, e.g. BK7F3K9Q') }),
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
  spec('list_room_types', 'Room types with price, capacity and how many rooms of each exist.', z.object({}), async ({ hotel }) => {
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
  spec(
    'list_rooms',
    'Physical rooms with their status (available, occupied, cleaning, out_of_service) and the guest currently in them.',
    z.object({ status: z.enum(['available', 'occupied', 'cleaning', 'out_of_service']).optional() }),
    async ({ hotel }, { status }) => (await listRoomsWithStays(hotel, { status })).map(roomBrief),
  ),
  spec(
    'list_callbacks',
    'The ticket queue for staff: agent hand-offs, failed refunds, undeliverable messages.',
    z.object({
      status: z.string().optional().describe('open, in_progress or done; comma separated (default open and in_progress)'),
      priority: z.string().optional().describe('low, normal or high; comma separated'),
      type: z.string().optional().describe('callback, question, complaint, booking_help, group_booking, payment, special_request or system; comma separated'),
      limit,
    }),
    async ({ hotel }, { status, priority, type, limit: n }) => {
      const r = await listCallbacks(hotel._id, { status: status || 'open,in_progress', priority, type }, page(n));
      return { total: r.total, callbacks: r.items.map(callbackBrief) };
    },
  ),
  spec(
    'list_calls',
    'Recent calls handled by the guest-facing AI agent, with outcome, language and summary.',
    z.object({
      outcome: z.enum(['booked', 'cancelled', 'modified', 'inquiry', 'callback_requested', 'abandoned', 'other']).optional(),
      limit,
    }),
    async ({ hotel }, { outcome, limit: n }) => {
      const r = await listCalls(hotel._id, { outcome }, page(n));
      return { total: r.total, calls: r.items.map(callBrief) };
    },
  ),
  spec(
    'get_call',
    'One AI call in detail: summary plus the conversation and the tools the agent used (useful to see what went wrong).',
    z.object({ id: z.string().describe('Call id from list_calls') }),
    async ({ hotel }, { id }) => {
      const call = await findCall(hotel._id, id);
      if (!call) return { error: 'Call not found' };
      return { ...callBrief(call), model: call.model, conversation: call.transcript.map((t) => `${t.role}: ${t.text}`).slice(-60) };
    },
  ),
  spec(
    'list_payments',
    'Payments and refunds, newest first. Useful for pending refunds (status refund_pending) or unpaid links (status created).',
    z.object({
      status: z.string().optional().describe('created, paid, expired, cancelled, failed, refund_pending, refunded; comma separated'),
      kind: z.enum(['charge', 'refund']).optional(),
      limit,
    }),
    async ({ hotel }, { status, kind, limit: n }) => {
      const r = await listPayments(hotel._id, { status, kind }, page(n));
      return { total: r.total, payments: r.items.map(paymentBrief) };
    },
  ),
  spec(
    'search_guests',
    'Find guests by name, phone or email, with their booking count and lifetime spend.',
    z.object({ query: z.string().optional(), limit }),
    async ({ hotel }, { query, limit: n }) => {
      const r = await listGuests(hotel, query, page(n));
      return { total: r.total, guests: r.items.map(guestBrief) };
    },
  ),
  spec(
    'get_guest',
    "One guest's profile with their bookings and calls.",
    z.object({ id: z.string().describe('Guest id from search_guests') }),
    async ({ hotel }, { id }) => {
      const g = await guestProfile(hotel, id);
      return {
        guest: { name: g.guest.name, phone: g.guest.phone, email: g.guest.email, vip: g.guest.vip, notes: g.guest.notes },
        bookings: g.bookings.map(bookingBrief),
        calls: g.calls.map(callBrief),
      };
    },
  ),
  spec(
    'get_property_info',
    "The property's facts and policies: address, times, amenities, payment, cancellation and FAQs.",
    z.object({}),
    async ({ hotel }) => ({
      ...hotelProfileForAgent(hotel),
      todayAtProperty: todayIn(hotel.timezone),
    }),
  ),
];

/** Runs one tool spec. Never throws: errors come back as `{ error }` so the model can explain or retry. */
async function execute(s, ctx, args) {
  try {
    return await s.run(ctx, args);
  } catch (e) {
    return { error: e.message, details: e.details };
  }
}

/** Runs a tool by name with schema validation, without a model (used by the tests). */
export async function runStaffTool(ctx, name, args = {}) {
  const found = staffToolSpecs.find((s) => s.name === name);
  if (!found) return { error: `Unknown tool ${name}` };
  const parsed = found.schema.safeParse(args);
  if (!parsed.success) return { error: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ') };
  return execute(found, ctx, parsed.data);
}
