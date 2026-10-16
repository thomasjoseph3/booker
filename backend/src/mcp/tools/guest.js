import { z } from 'zod';
import { toJsonSchema } from '../../agent/shared/schema.js';

/**
 * The receptionist's tools, defined here in the MCP code: everything it is allowed to do. A spec is
 * `{ name, description, schema (zod), http }`; `http` says which /api/agent endpoint does the work. The MCP server
 * (mcp/servers.js) publishes them, and the voice agent learns them from the server (tools/list), so this file is
 * the only place a tool is written. (The public list at GET /api/agent/tools is built from it too.)
 */

const phone = z
  .string()
  .optional()
  .describe("Caller's phone number. It defaults to the caller ID, so only pass it if they give another number");
const code = z.string().describe('Booking code, e.g. BK7F3K9Q');
const day = (what) => z.string().describe(`${what} date, YYYY-MM-DD`);
const count = () => z.coerce.number().int();

const spec = (name, description, schema, http) => ({ name, description, schema, http });

export const guestToolSpecs = [
  spec(
    'get_hotel_info',
    "Property details: address, check-in/out times, amenities, policies, FAQs, payment and cancellation policy, and today's date at the property.",
    z.object({}),
    { method: 'GET', path: '/api/agent/hotel' },
  ),
  spec('list_room_types', 'All room types with descriptions, occupancy limits and base prices.', z.object({}), {
    method: 'GET',
    path: '/api/agent/room-types',
  }),
  spec(
    'list_special_rates',
    'The hotel\'s offers and special rates: percentage discounts with their conditions (minimum nights, book in advance, stay dates), and date-range rates (cheaper, festival or peak). Use it when the caller asks about offers, discounts, deals, seasonal or festival prices, or the best time to visit.',
    z.object({}),
    { method: 'GET', path: '/api/agent/special-rates' },
  ),
  spec(
    'price_stay',
    'The exact price of ONE room type for a specific number of rooms and dates, with the step-by-step calculation. Use it every time the caller asks about a price you were not just given: a different number of rooms, other dates, one room instead of the total (or for a mix of rooms pass them all in "rooms" in one call and read the grand total). Never work out a price yourself.',
    z.object({
      checkIn: day('Check-in'),
      checkOut: day('Check-out'),
      roomType: z.string().optional().describe('Room type name, code or id (one room type). For a mix of rooms use "rooms" instead'),
      adults: count().optional(),
      children: count().optional(),
      roomsCount: count().optional().describe('How many rooms of this type'),
      rooms: z
        .array(z.object({ roomType: z.string(), adults: count(), children: count().optional(), roomsCount: count().optional() }))
        .optional()
        .describe('A mix of rooms, e.g. one Garden Cottage and one Lake View Villa, each with the guests staying in it. The grand total is added up for you.'),
    }),
    { method: 'POST', path: '/api/agent/quote' },
  ),
  spec(
    'calculate',
    'A calculator. Use it for ANY arithmetic you would say aloud (adding two quotes, a difference, a split, a percentage, nights x rate). Never do sums in your head. Write the expression with numbers and + - * / ( ) %, e.g. "52416 + 26208" or "26000 - 10% * 26000".',
    z.object({ expression: z.string().describe('Arithmetic expression, numbers only') }),
    { method: 'POST', path: '/api/agent/calculate' },
  ),
  spec(
    'check_availability',
    'Check which room types are available for given dates and party size, with prices including tax and the advance required.',
    z.object({
      checkIn: day('Check-in'),
      checkOut: day('Check-out'),
      adults: count(),
      children: count().optional(),
      roomsCount: count().optional(),
    }),
    { method: 'POST', path: '/api/agent/availability' },
  ),
  spec(
    'create_booking',
    'Book a room after the caller has confirmed room type, dates, guests and price. Sends the payment link by email and/or WhatsApp when an advance is required; the room is held for the property hold window (default 30 minutes) and released automatically if unpaid. Read back details before calling.',
    z.object({
      roomTypeId: z.string(),
      checkIn: day('Check-in'),
      checkOut: day('Check-out'),
      adults: count(),
      children: count().optional(),
      roomsCount: count().optional(),
      guest: z.object({ name: z.string(), phone, email: z.string().optional() }),
      specialRequests: z.string().optional(),
      paymentMode: z.enum(['online', 'pay_at_hotel']).optional(),
      callId: z.string().optional(),
    }),
    { method: 'POST', path: '/api/agent/bookings' },
  ),
  spec(
    'find_bookings',
    "Find the caller's upcoming bookings by phone, optionally narrowed to a booking code.",
    z.object({ phone, code: code.optional() }),
    { method: 'GET', path: '/api/agent/bookings' },
  ),
  spec(
    'get_cancellation_quote',
    'Before cancelling, get the cancellation fee and refund amount to tell the caller.',
    z.object({ code, phone }),
    { method: 'GET', path: '/api/agent/bookings/{code}/cancellation-quote' },
  ),
  spec(
    'cancel_booking',
    'Cancel a booking after the caller has heard and accepted the fee/refund.',
    z.object({ code, phone, reason: z.string().optional() }),
    { method: 'POST', path: '/api/agent/bookings/{code}/cancel' },
  ),
  spec(
    'modify_booking',
    'Change dates, room type, number of rooms, guests or special requests. Price is recalculated; a new payment link or refund is issued if needed.',
    z.object({
      code,
      phone,
      checkIn: day('New check-in').optional(),
      checkOut: day('New check-out').optional(),
      roomTypeId: z.string().optional(),
      roomsCount: count().optional(),
      adults: count().optional(),
      children: count().optional(),
      specialRequests: z.string().optional(),
    }),
    { method: 'PATCH', path: '/api/agent/bookings/{code}' },
  ),
  spec(
    'resend_payment_link',
    'Resend (and extend) the payment link for a booking awaiting payment, or send a link for the remaining balance.',
    z.object({ code, phone }),
    { method: 'POST', path: '/api/agent/bookings/{code}/payment-link' },
  ),
  spec(
    'request_human_callback',
    'Raise a ticket for hotel staff to follow up. Use it when the guest asks for a person, has a complaint, a group/corporate booking, a payment problem, a special arrangement, or asks something you cannot answer from the tools. Say in "reason" what the guest needs, in one or two sentences.',
    z.object({
      name: z.string().optional(),
      phone,
      type: z
        .enum(['callback', 'question', 'complaint', 'booking_help', 'group_booking', 'payment', 'special_request', 'system'])
        .optional()
        .describe(
          'callback = wants a person to call; question = you could not answer it; complaint; booking_help = a booking problem you could not fix; group_booking = group/corporate/event; payment = payment or refund problem; special_request = bargaining, extra arrangements',
        ),
      reason: z.string(),
      priority: z.enum(['low', 'normal', 'high']).optional(),
      bookingCode: code.optional(),
      callId: z.string().optional(),
    }),
    { method: 'POST', path: '/api/agent/callbacks' },
  ),
];

export const guestToolSpecByName = Object.fromEntries(guestToolSpecs.map((s) => [s.name, s]));

/** OpenAI-style definitions served at GET /api/agent/tools, for agent runtimes outside this codebase. */
export const agentTools = guestToolSpecs.map(({ name, description, schema, http }) => ({
  type: 'function',
  function: { name, description, parameters: toJsonSchema(schema) },
  http,
}));
