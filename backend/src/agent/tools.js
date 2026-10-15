/**
 * The agent's tools: everything it is allowed to do, in OpenAI-style function-calling format.
 * `http` says which /api/agent endpoint implements each tool. Served publicly at GET /api/agent/tools
 * so any external agent runtime can load them, and used by the built-in Gemini agents.
 */

const fn = (name, description, properties, required, http) => ({
  type: 'function',
  function: { name, description, parameters: { type: 'object', properties, required } },
  http,
});

const phone = { type: 'string', description: "Caller's phone number (use caller ID unless they give another)" };
const code = { type: 'string', description: 'Booking code, e.g. BK7F3K9Q' };
const day = (d) => ({ type: 'string', description: `${d} date, YYYY-MM-DD` });

export const agentTools = [
  fn('get_hotel_info', 'Property details: address, check-in/out times, amenities, policies, FAQs, payment and cancellation policy, and today\'s date at the property.', {}, [], { method: 'GET', path: '/api/agent/hotel' }),
  fn('list_room_types', 'All room types with descriptions, occupancy limits and base prices.', {}, [], { method: 'GET', path: '/api/agent/room-types' }),
  fn(
    'check_availability',
    'Check which room types are available for given dates and party size, with prices including tax and the advance required.',
    { checkIn: day('Check-in'), checkOut: day('Check-out'), adults: { type: 'integer' }, children: { type: 'integer' }, roomsCount: { type: 'integer' } },
    ['checkIn', 'checkOut', 'adults'],
    { method: 'POST', path: '/api/agent/availability' },
  ),
  fn(
    'create_booking',
    'Book a room after the caller has confirmed room type, dates, guests and price. Sends the payment link on WhatsApp when an advance is required; the room is held for the property hold window (default 30 minutes) and released automatically if unpaid. Read back details before calling.',
    {
      roomTypeId: { type: 'string' },
      checkIn: day('Check-in'),
      checkOut: day('Check-out'),
      adults: { type: 'integer' },
      children: { type: 'integer' },
      roomsCount: { type: 'integer' },
      guest: { type: 'object', properties: { name: { type: 'string' }, phone, email: { type: 'string' } }, required: ['name', 'phone'] },
      specialRequests: { type: 'string' },
      paymentMode: { type: 'string', enum: ['online', 'pay_at_hotel'] },
      callId: { type: 'string' },
    },
    ['roomTypeId', 'checkIn', 'checkOut', 'adults', 'guest'],
    { method: 'POST', path: '/api/agent/bookings' },
  ),
  fn('find_bookings', "Find the caller's upcoming bookings by phone, optionally narrowed to a booking code.", { phone, code }, ['phone'], { method: 'GET', path: '/api/agent/bookings', in: 'query' }),
  fn('get_cancellation_quote', 'Before cancelling, get the cancellation fee and refund amount to tell the caller.', { code, phone }, ['code', 'phone'], { method: 'GET', path: '/api/agent/bookings/{code}/cancellation-quote', in: 'query' }),
  fn('cancel_booking', 'Cancel a booking after the caller has heard and accepted the fee/refund.', { code, phone, reason: { type: 'string' } }, ['code', 'phone'], { method: 'POST', path: '/api/agent/bookings/{code}/cancel' }),
  fn(
    'modify_booking',
    'Change dates, room type, number of rooms, guests or special requests. Price is recalculated; a new payment link or refund is issued if needed.',
    { code, phone, checkIn: day('New check-in'), checkOut: day('New check-out'), roomTypeId: { type: 'string' }, roomsCount: { type: 'integer' }, adults: { type: 'integer' }, children: { type: 'integer' }, specialRequests: { type: 'string' } },
    ['code', 'phone'],
    { method: 'PATCH', path: '/api/agent/bookings/{code}' },
  ),
  fn('resend_payment_link', 'Resend (and extend) the payment link for a booking awaiting payment, or send a link for the remaining balance.', { code, phone }, ['code', 'phone'], { method: 'POST', path: '/api/agent/bookings/{code}/payment-link' }),
  fn(
    'request_human_callback',
    'Hand off to hotel staff: complaints, group/corporate bookings, special arrangements, or anything you cannot handle.',
    { name: { type: 'string' }, phone, reason: { type: 'string' }, priority: { type: 'string', enum: ['low', 'normal', 'high'] }, bookingCode: code, callId: { type: 'string' } },
    ['phone', 'reason'],
    { method: 'POST', path: '/api/agent/callbacks' },
  ),
];

export const toolByName = Object.fromEntries(agentTools.map((t) => [t.function.name, t]));

/** The same tools as Gemini `functionDeclarations` (it rejects an empty `parameters` object). */
export const geminiFunctionDeclarations = agentTools.map(({ function: f }) => ({
  name: f.name,
  description: f.description,
  ...(Object.keys(f.parameters.properties).length ? { parameters: f.parameters } : {}),
}));
