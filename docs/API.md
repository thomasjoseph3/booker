# API reference

Base URL (local): `http://localhost:4000`. All bodies are JSON. Dates are hotel-local calendar days, `YYYY-MM-DD`.
Money is in the property's currency, in major units (e.g. rupees), rounded to 2 decimals.

## Conventions

**Errors** always look like this:

```json
{ "error": { "code": "NO_AVAILABILITY", "message": "Pool Villa is not available on 2026-10-28", "details": { "date": "2026-10-28" } } }
```

| HTTP | `code` examples | Meaning |
|---|---|---|
| 400 | `VALIDATION_ERROR`, `BAD_REQUEST` | Bad input. `message` is human-readable, e.g. `checkIn: Use YYYY-MM-DD` or `Check-in date 2026-01-01 is in the past`. |
| 401 | `UNAUTHORIZED` | Missing/invalid token or API key |
| 403 | `FORBIDDEN` | Authenticated, but not allowed (wrong property or role) |
| 404 | `NOT_FOUND` | Unknown record. Also returned when a booking code doesn't match the caller's phone. |
| 409 | `NO_AVAILABILITY`, `NOT_CANCELLABLE`, `INVALID_STATE`, `BALANCE_DUE`, `NOT_ARRIVAL_DAY`, `DUPLICATE` | The request conflicts with the current state |
| 429 | `TOO_MANY_REQUESTS` | Login rate limit (10 attempts / 15 min per email + IP) |

**Booking statuses**

```
pending_payment ──paid──► confirmed ──check-in──► checked_in ──check-out──► checked_out
      │                      │  └──no-show──► no_show
      │                      └──cancel──► cancelled
      ├──hold expires──► expired   (late payment: re-confirmed if rooms still free, else auto-refund)
      └──cancel──► cancelled
```

---

## 1. Agent API (`/api/agent`): for the phone agent and other integrations

Authentication: send **one** of the following:

| Headers | Scope |
|---|---|
| `x-api-key: <hotel key>` | That one property (key from seed output or Settings → "Generate new API key") |
| `x-api-key: <AGENT_MASTER_KEY>` + `x-hotel-id: <hotel id or slug>` | Any property. Use this for one agent deployment serving many hotels. |

Optional `x-call-id: <id>` tags history entries with the call.

Bookings are identified by **code + the caller's phone number**. A booking code alone never reveals a booking.
Phone numbers are matched on the last 10 digits, so `9847012345` matches `+91 98470 12345`.

### `GET /api/agent/tools` (public)
Function-calling definitions (OpenAI / Ollama `tools` format) for every endpoint below, each with its `http` method and path.

### `GET /api/agent/resolve?number=+914842000100` (master key only)
Maps a dialed number to its property: `{ "hotelId", "name", "greeting", "language" }`.

### `GET /api/agent/hotel`
Property profile: address, contact, `todayAtProperty`, check-in/out times, amenities, policies, FAQs, tax,
`paymentPolicy` and `cancellationPolicy` as plain sentences, and agent greeting and instructions.

### `GET /api/agent/room-types`
All active room types with descriptions, occupancy limits, base, weekend and seasonal prices.

### `POST /api/agent/availability`
```json
{ "checkIn": "2026-10-28", "checkOut": "2026-10-30", "adults": 2, "children": 0, "roomsCount": 1 }
```
Response (one option shown):
```json
{
  "checkIn": "2026-10-28", "checkOut": "2026-10-30", "nights": 2, "adults": 2, "children": 0, "currency": "INR",
  "options": [{
    "roomTypeId": "6ac7623133665fb3ffe782b7", "code": "GC", "name": "Garden Cottage",
    "description": "Cottage facing the tropical garden with a private sit-out.",
    "bedType": "King", "view": "Garden", "sizeSqft": 380, "maxAdults": 2, "maxChildren": 1, "maxOccupancy": 3,
    "amenities": ["AC", "Smart TV", "Mini fridge", "Tea/coffee maker"],
    "availableRooms": 3, "roomsNeeded": 1, "bookable": true,
    "quote": {
      "currency": "INR", "nights": 2, "roomsCount": 1,
      "nightlyRates": [{ "date": "2026-10-28", "price": 6500 }, { "date": "2026-10-29", "price": 6500 }],
      "averageNightlyRate": 6500, "subtotal": 13000, "tax": 1560, "taxPercent": 12, "total": 14560, "advanceDue": 4368
    }
  }]
}
```
`roomsNeeded` is how many rooms of that type the party needs. `bookable: false` comes with a `reason`.
Options are sorted bookable-first, then by price.

### `POST /api/agent/bookings`
```json
{
  "roomTypeId": "6ac7623133665fb3ffe782b7",
  "checkIn": "2026-10-28", "checkOut": "2026-10-30", "adults": 2, "children": 0, "roomsCount": 1,
  "guest": { "name": "Anjali Menon", "phone": "+919847012345", "email": "anjali@example.com" },
  "specialRequests": "Late arrival ~10pm",
  "paymentMode": "online",
  "callId": "call-123"
}
```
`201`:
```json
{
  "booking": {
    "code": "BK7F3K9Q", "status": "pending_payment", "roomType": "Garden Cottage", "checkIn": "2026-10-28", "checkOut": "2026-10-30",
    "total": 14560, "advanceDue": 4368, "amountPaid": 0, "balanceDue": 14560, "holdExpiresAt": "2026-10-08T09:59:15.000Z",
    "paymentLink": "http://localhost:4000/pay/mock/6ac7…", "…": "…"
  },
  "sayNext": "A payment link for INR 4,368 has been sent on WhatsApp to +919847012345. The room is held until 03:29 pm. …"
}
```
- `paymentMode: "pay_at_hotel"` is accepted only when the property allows it. The booking is then `confirmed` immediately.
- If the advance is `0`, the booking is confirmed immediately.
- `409 NO_AVAILABILITY` if the room sold out in the meantime.
- `sayNext` is a ready-to-speak sentence describing the result.

### `GET /api/agent/bookings?phone=…&code=…`
With `code`: that booking (only if `phone` matches). Without: the caller's upcoming live bookings.
Each includes `paymentLink` while a link is open.

### `GET /api/agent/bookings/:code/cancellation-quote?phone=…`
```json
{ "code": "BK7F3K9Q", "cancellable": true, "freeCancellation": false, "hoursBeforeCheckIn": 30.5, "freeUntilHours": 72,
  "amountPaid": 4368, "fee": 4368, "refundAmount": 0, "currency": "INR",
  "policy": "Free cancellation up to 72 hours before check-in; after that 50% of the booking total is charged." }
```
The fee never exceeds what the guest actually paid.

### `POST /api/agent/bookings/:code/cancel`
`{ "phone": "…", "reason": "Plans changed" }` → `{ booking, fee, refundAmount, sayNext }`. Releases the rooms, cancels open links,
refunds through the gateway and messages the guest.

### `PATCH /api/agent/bookings/:code`
`{ "phone": "…", "checkOut": "2026-10-31" }`. Any of `checkIn, checkOut, roomTypeId, roomsCount, adults, children, specialRequests`.
Re-prices the stay and moves inventory atomically. If the new total needs more advance, a top-up link is sent. If the guest has now
overpaid, the difference is refunded.

### `POST /api/agent/bookings/:code/payment-link`
`{ "phone": "…" }`. For `pending_payment`, it extends the hold by the hold window and sends a fresh link. For confirmed and in-house
bookings, it sends a link for the balance.

### `POST /api/agent/callbacks`
`{ "name": "…", "phone": "…", "reason": "Group of 15 rooms", "priority": "high", "bookingCode": "BK…", "callId": "…" }` → appears in the admin **Callbacks** queue.

### `POST /api/agent/calls`
Create or update a call record (upsert by `callId`). `transcript` entries are **appended**, so the call can be logged incrementally.
```json
{ "callId": "call-123", "fromNumber": "+919847012345", "toNumber": "+914842000100", "startedAt": "2026-10-08T09:00:00Z",
  "endedAt": "2026-10-08T09:04:12Z", "durationSec": 252, "intent": "new_booking", "outcome": "booked", "sentiment": "positive",
  "summary": "Booked Garden Cottage for 2 nights", "bookingCodes": ["BK7F3K9Q"], "recordingUrl": "https://…",
  "transcript": [{ "role": "caller", "text": "Hi, I'd like a room…" }, { "role": "agent", "text": "Of course!" }] }
```
`outcome` is one of `booked, cancelled, modified, inquiry, callback_requested, abandoned, other`.

---

## 2. Admin API (`/api/admin`): for the dashboard

`POST /api/admin/auth/login` with `{ "email", "password" }` returns `{ token, user }`. Send `Authorization: Bearer <token>` (valid 12 h).

Roles: **super_admin** (all properties), **hotel_admin** (assigned properties, including configuration),
**staff** (assigned properties, operations only). A request for a property outside your scope returns `403`.

| Method & path | Who | Purpose |
|---|---|---|
| `GET /auth/me` | all | Current user |
| `GET/POST /users`, `PATCH /users/:id` | super_admin | Manage admin users and their properties |
| `GET /hotels` | all | Properties you can access |
| `POST /hotels` | super_admin | Create a property |
| `GET /hotels/:hotelId` | all | Property settings |
| `PATCH /hotels/:hotelId` | managers | Update settings. Nested objects are merged, e.g. `{ "payment": { "holdMinutes": 30 } }` |
| `POST /hotels/:hotelId/agent-key` | managers | Rotate the property's agent API key (returned once) |

Everything below is under `/api/admin/hotels/:hotelId`:

| Method & path | Who | Purpose |
|---|---|---|
| `GET /dashboard` | all | Today: occupancy, arrivals, departures, in-house, holds, callbacks, calls, 30-day revenue, 14-night occupancy |
| `GET /analytics?days=30` | all | Calls (outcomes, conversion, per day and hour, sentiment, intents), agent payment conversion and expired holds, revenue by channel and room type, ADR, repeat guests, occupancy |
| `GET /bookings` | all | Filters: `status` (comma list), `view` = `arrivals`/`departures`/`in_house` (+`date`), `from`/`to` (stay overlaps), `source`, `q` (code/name/phone/email), `page`, `limit` |
| `POST /bookings` | all | Create (any `source`; staff may use `pay_at_hotel`) |
| `GET /bookings/:code` | all | Booking + payments + WhatsApp messages + linked calls + cancellation quote |
| `PATCH /bookings/:code` | all | Modify stay (same rules as agent) |
| `GET /bookings/:code/cancellation-quote` | all | Fee and refund preview |
| `POST /bookings/:code/cancel` | all | `{ reason, waiveFee }` |
| `POST /bookings/:code/check-in` | all | `{ roomIds? }`. Assigns specific rooms, or picks free ones automatically. Allowed from the arrival date. |
| `POST /bookings/:code/check-out` | all | `{ force? }`. Refuses with `409 BALANCE_DUE` unless settled or forced. Frees remaining nights on early departure. |
| `POST /bookings/:code/no-show` | all | From the arrival date. Applies the no-show fee and refunds any excess. |
| `POST /bookings/:code/payments` | all | Record a desk payment `{ amount, method: cash/card/upi/bank_transfer/other, note }` |
| `POST /bookings/:code/payment-link` | all | Resend advance link / send balance link |
| `POST /bookings/:code/notes` | all | Internal note in the booking timeline |
| `POST /availability` | all | Same as the agent endpoint |
| `GET /inventory?from&to` | all | Per room type per night: booked, available, closed (max 92 days) |
| `PUT /inventory/stop-sell` | managers | `{ roomTypeId, from, to, closed }`. Close or open nights for sale. |
| `GET/POST /room-types`, `PATCH/DELETE /room-types/:id` | managers (GET: all) | Room types, prices, seasonal `rateOverrides`. DELETE deactivates. |
| `GET/POST /rooms`, `PATCH/DELETE /rooms/:id` | managers (status PATCH: all) | Physical rooms. Rooms that aren't out of service set `totalRooms`. |
| `GET /payments` | all | Filters `kind`, `status` |
| `POST /payments/:id/mark-refunded` | all | Close a manual (offline) refund |
| `GET /guests?q`, `GET /guests/:id`, `PATCH /guests/:id` | all | Guests with lifetime stats; profile with bookings and calls; VIP and notes |
| `GET /calls?outcome`, `GET /calls/:id` | all | Call log and full transcript |
| `GET /callbacks?status`, `PATCH /callbacks/:id` | all | Staff task queue (agent hand-offs, failed refunds, undeliverable messages). No screen in the dashboard; the staff assistant reports on it |
| `GET /notifications` | all | Every message sent to guests (email and WhatsApp) |
| `GET /assistant/chats?scope=mine\|all` | all | The staff assistant's conversation history (`all` is honoured for managers only) |
| `POST /assistant/chats` | all | Start a conversation |
| `GET /assistant/chats/:id` | owner, managers | A conversation with every message and the tool calls behind each answer |
| `POST /assistant/chats/:id/messages` | owner | `{ text }`. Returns `{ reply, tools }`. Read-only assistant; 20 messages per minute per user |

---

## 3. Public API (`/api/public`) and live voice calls

No authentication. Used by the guest website (`site/`).

| Path | Purpose |
|---|---|
| `GET /api/public/hotels/:slug` | Property profile: description, address, amenities, FAQs, room types with "from" prices |
| `WS /api/live?hotel=<slug>&phone=…&email=…` | Real-time voice call with the AI agent (`phone` and `email` optional) |

The WebSocket carries **binary frames for audio** (client to server: PCM 16-bit 16 kHz mono; server to client: PCM 16-bit
24 kHz mono) and **JSON text frames for events**:

| Direction | Event | Meaning |
|---|---|---|
| server → client | `ready` | Connected; the greeting starts |
| server → client | `transcript {role, text}` | Caption chunk (`caller` or `agent`) |
| server → client | `tool {name, ok}` | The agent ran a tool |
| server → client | `interrupt` | The caller spoke over the agent; drop queued audio |
| server → client | `ended {summary, outcome, durationSec}` | Call finished |
| server → client | `error {message}` | Could not connect, all lines busy, etc. |
| client → server | `end` | Hang up |
| client → server | `text {text}` | A typed message instead of speech |

Limits: `MAX_LIVE_CALLS` concurrent calls, `MAX_LIVE_MINUTES` per call. See [VOICE_AGENT.md](VOICE_AGENT.md).

---

## 4. Payments

| Path | Purpose |
|---|---|
| `POST /api/payments/webhook/razorpay` | Razorpay webhook (`payment_link.paid`, `payment_link.expired`/`cancelled`), verified with `X-Razorpay-Signature` |
| `POST /api/payments/webhook/stripe` | Stripe webhook (`checkout.session.completed`/`expired`), verified with `Stripe-Signature` |
| `GET/POST /pay/mock/:paymentId` | Test payment page used when `PAYMENT_PROVIDER=mock` (no money moves) |
| `GET /pay/return` | Page guests land on after paying |

Webhooks are idempotent: gateways retry, and a payment is only ever counted once.
