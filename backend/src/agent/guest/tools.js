import { z } from 'zod';
import { toJsonSchema } from '../shared/schema.js';

/**
 * The receptionist's tools: everything it is allowed to do. A spec is `{ name, description, schema (zod), http }`;
 * `http` says which /api/agent endpoint implements it. The specs are the single source of truth for:
 *  - the LangChain tools the live call uses (toolRunner.js),
 *  - the public list at GET /api/agent/tools, so an external agent runtime can load the same tools,
 *  - the Gemini function declarations sent when a call starts.
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
    'Hand off to hotel staff: complaints, group/corporate bookings, special arrangements, or anything you cannot handle.',
    z.object({
      name: z.string().optional(),
      phone,
      reason: z.string(),
      priority: z.enum(['low', 'normal', 'high']).optional(),
      bookingCode: code.optional(),
      callId: z.string().optional(),
    }),
    { method: 'POST', path: '/api/agent/callbacks' },
  ),
];

/**
 * Call control, handled by the live call itself rather than by an HTTP endpoint (so it is not in the public tool list).
 * The model calls it after it has said goodbye; liveAgent.js then hangs up once that last turn has finished playing.
 */
export const endCallSpec = spec(
  'end_call',
  'Hang up the call. Use it only when everything is done, you have asked whether there is anything else, and the caller said no or said goodbye. Say your goodbye first, then call this. Never use it while the caller still has a question or a booking is half done.',
  z.object({}),
  null,
);

export const guestToolSpecByName = Object.fromEntries(guestToolSpecs.map((s) => [s.name, s]));

/** OpenAI-style definitions served at GET /api/agent/tools, for agent runtimes outside this codebase. */
export const agentTools = guestToolSpecs.map(({ name, description, schema, http }) => ({
  type: 'function',
  function: { name, description, parameters: toJsonSchema(schema) },
  http,
}));
