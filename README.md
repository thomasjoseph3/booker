# Hotel Agent Platform

A multi-property hotel booking platform with an AI voice receptionist. Each hotel or resort gets rooms, live
availability, pricing, advance-payment holds, guest messaging (email and WhatsApp), call logs and analytics, a
dashboard for its staff (with an AI assistant they can ask about analytics, availability and bookings), and a public website where guests can **call the AI agent from the browser** to book.

The platform supports many hotels and resorts; the demo focuses on **one property** (Lakeside Palms Resort, 30 rooms).

```
 Guest ─► site/  Next.js website ──voice (WebSocket)──► backend/agent ──► Gemini Live
                                                              │
 Hotel staff ─► admin/  Next.js dashboard ──────────────►  backend/  Express API  ──►  MongoDB
                                                           booking rules, 30-min holds,
                                                           payments, email/WhatsApp, inventory
```

| Folder | What it is | Port |
|---|---|---|
| `backend/` | Express 5 + Mongoose REST API: all business rules, the database and the AI agent | 4000 |
| `admin/`   | Next.js 16 dashboard for hotel staff (talks only to the API) | 3000 |
| `site/`    | Next.js 16 public website with the "Call to book" voice button | 3001 |

There's one backend for everything. The admin, the website and the agent all use the same booking rules (holds,
inventory, refunds), so they can't drift apart. How the code is organised: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).
How the voice call works: [docs/VOICE_AGENT.md](docs/VOICE_AGENT.md).

---

## Run it locally

**You need:** Node.js 20+ and MongoDB 6+ running on `mongodb://127.0.0.1:27017`.

```bash
cd "hotel agent"
npm run setup     # installs all three apps, creates backend/.env, admin/.env.local and site/.env.local
npm run seed      # resets the database: one 30-room resort with today's guests (see "Demo data")
npm run dev       # starts the API (:4000), the admin (:3000) and the guest website (:3001)
npm run demo:call # in a second terminal: a simulated phone booking through the agent API
```

Open **http://localhost:3000** for the admin and **http://localhost:3001** for the guest website. If a port is busy, Next.js picks the next free one and prints it.

For the voice agent add `GEMINI_API_KEY` to `backend/.env` (see [Going live](#going-live)). Use Chrome and headphones.

### Demo logins (password for all: `Admin@123`)

| Email | Role | Sees |
|---|---|---|
| `manager@lakesidepalms.local` | Hotel manager | Everything for the resort, including settings and pricing |
| `desk@lakesidepalms.local` | Front desk | Bookings and operations, read-only settings |
| `admin@platform.local` | Platform admin | Every property on the platform (a switcher appears once there are several) |

### Other commands

```bash
npm test          # unit tests, then the end-to-end suite on a throwaway database (28 checks: race conditions, a 2nd hotel for isolation, …)
npm --prefix backend run test:unit   # just the fast unit tests
npm run lint      # ESLint on backend, admin and site (backend also enforces the layering rules)
npm run format    # Prettier on the backend
npm run check     # verifies the live database: no overbooking, inventory matches bookings
npm run build && npm start   # production build of the admin + production servers
```

---

## Demo data

`npm run seed` resets the database to **one property, Lakeside Palms Resort (Kumarakom, Kerala), with 30 rooms**:

| Room type | Rooms | Weekday / weekend price |
|---|---|---|
| Garden Cottage | 101–114 (14) | ₹6,500 / ₹7,500 |
| Lake View Villa | 201–210 (10) | ₹11,000 / ₹12,500 |
| Pool Villa | 301–306 (6) | ₹22,000 / ₹25,000 |

**The situation today:**
- **10 rooms occupied.** In-house guests with assigned rooms, leaving over the next 1–3 days, advance paid, balance due at check-out.
- **5 rooms being cleaned.** Guests checked out this morning between 8:10 and 10:40. The vacate time is shown per room.
- **15 rooms clean and free.**

There's no call history and no old bookings. Tonight the agent can sell **20 rooms**: the 15 free ones plus the 5 being
cleaned, which will be ready long before new guests arrive. Selling is based on nights, and housekeeping status
is shown separately on the board.

### See how the agent will work: `npm run demo:call`

With the servers running, this plays a phone call: a guest dials the resort, asks for a room tonight, picks the Lake View
Villa, and pays the WhatsApp link. The caller's and agent's lines are scripted, because there is no AI yet, but **every tool call is
the real agent API**, in the order the agent will make them:

```
resolve_property(+914842000100) → Lakeside Palms Resort
get_hotel_info()                → today's date, policies, greeting
check_availability(tonight, 2 adults) → 9 cottages · 7 villas · 4 pool villas, prices incl. tax
create_booking(...)             → room held 30 min, payment link sent on WhatsApp
(guest pays)                    → confirmed, check-in details sent on WhatsApp
log_call(transcript, outcome)   → appears under Agent calls
```

Afterwards the booking, the call transcript and the WhatsApp messages are all visible in the admin.
`npm run demo:call -- --unpaid` leaves the payment unpaid, so you can watch the hold expire on the dashboard after 30 minutes.

### Adding more hotels or resorts

Nothing in the code is tied to one property. A platform admin creates another property (`POST /api/admin/hotels`), and it
gets its own rooms, prices, policies, phone number, staff logins and agent greeting. The single agent tells properties apart
by the number the guest dialed (`GET /api/agent/resolve`). The test suite onboards a second hotel this way and checks
that neither hotel can see the other's data. Refer to properties by **slug** (`lakeside-palms`), because IDs change on every re-seed.

---

## How a voice booking works

1. The caller asks for dates → `POST /api/agent/availability` returns rooms, prices incl. tax and the advance due.
2. The caller confirms → `POST /api/agent/bookings`:
   - the rooms are **held** (status `pending_payment`) for the property's hold window (**30 minutes** by default);
   - a payment link for the advance is created and sent to the guest by **email and/or WhatsApp** (`GUEST_CHANNELS`).
3. **Paid within 30 minutes** → the payment gateway webhook confirms the booking, and the guest gets a
   message with the confirmation and **check-in details** (address, map link, times, ID rules, balance due).
4. **Not paid in time** → a background job releases the rooms (status `expired`) and messages the guest.
   If a payment still arrives late, the system re-books the room when it's still free; otherwise it refunds automatically
   and creates a high-priority callback for staff.
5. Cancellations apply the property's policy (free window / late fee) and refund through the gateway.

Advance rules are per property: a percentage, the first night, the full amount, or none, with optional pay-at-hotel.
Overbooking is prevented by atomic per-night inventory counters. Ten simultaneous callers racing for six pool villas
get exactly six bookings (covered by `npm test`).

---

## Going live

Everything external is behind an adapter, so each switch below is a configuration change in `backend/.env`.

| What | Setting | Notes |
|---|---|---|
| Payments | `PAYMENT_PROVIDER=razorpay` + `RAZORPAY_*` | Razorpay Payment Links. Point the Razorpay webhook to `POST /api/payments/webhook/razorpay` (event `payment_link.paid`). `stripe` is also supported. |
| WhatsApp | `WHATSAPP_PROVIDER=meta` + `WHATSAPP_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID` | WhatsApp Cloud API. A guest who *called* hasn't messaged you, so Meta requires **approved templates**. Set `WHATSAPP_TEMPLATE_*` names. Twilio is also supported. |
| Guest messages | `GUEST_CHANNELS=email,whatsapp` | Which channels guests are messaged on. |
| Email | `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `EMAIL_FROM` | Any SMTP server. For Gmail use an App Password. Set `EMAIL_OVERRIDE_TO` in demos to send every email to yourself. |
| Voice agent | `GEMINI_API_KEY`, `GEMINI_LIVE_MODEL`, `GEMINI_LIVE_VOICE` | Google AI Studio key. Free keys have low per-minute limits; limit concurrent calls with `MAX_LIVE_CALLS`. |
| Public URL | `PUBLIC_BASE_URL` | Must be publicly reachable over HTTPS for gateway webhooks (use ngrok while testing). |
| Secrets | `JWT_SECRET`, `AGENT_MASTER_KEY` | `npm run setup` generates them. The server refuses to start in production with the default JWT secret. |

When delivery fails on every channel for a payment link or a confirmation, a high-priority callback is created so staff can
reach the guest another way.

### Scaling notes
- Stateless API: run several instances behind a load balancer. Keep the hold-expiry sweeper (`src/jobs.js`) on one
  instance, and move the login rate limiter to Redis.
- MongoDB indexes are created on startup. Booking codes, inventory rows and guests are unique per property.
- Multi-tenant by design: every record carries `hotel`, and every admin and agent request is scoped to the caller's properties.

---

## Project layout

```
backend/
  src/
    app.js, server.js, config.js, jobs.js   Express app, startup, settings, hold-expiry sweeper
    routes/admin.js                         Composes the admin API
    modules/                                One folder per feature: routes.js -> service.js -> repository.js
      auth hotels rooms inventory bookings payments guests calls conversations notifications analytics public
    agent/                                  guest/ (the receptionist), staff/ (the dashboard assistant), shared/ — built on LangChain
    models/                                 Mongoose schemas
    middleware/ utils/ validation.js        Shared plumbing
  scripts/seed.js, today-snapshot.js        Demo property and today's guests
  scripts/demo-call.js                      Simulated phone booking through the agent API
  scripts/smoke.js, test/unit/              End-to-end suite and unit tests
  scripts/check-data.js, test-email.js      Database integrity check; send a sample guest email
admin/
  src/app/login                             Sign in (session stored in an httpOnly cookie)
  src/app/h/[hotelId]/…                     Dashboard, bookings, assistant, agent calls, analytics, guests, rooms, availability, payments, messages, settings
  src/lib/api.ts, actions.ts                Server-side API client and server actions (the browser never sees the token)
site/
  src/app/                                  Public hotel page(s)
  src/lib/live-call.ts                      Browser audio engine for the voice call
  src/components/                           Landing page, call button and call screen
docs/                                       API.md, ARCHITECTURE.md, VOICE_AGENT.md
```

See **[docs/API.md](docs/API.md)** for every endpoint with request and response examples, and
**[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)** before changing the backend.
