# Backend architecture

The backend (`backend/`) is an Express 5 + Mongoose API organised **by feature**, with three layers inside each
feature. This page explains the rules, so new code lands in the right place.

## Layers

```
HTTP request
   │
   ▼
routes.js        Parse and validate input (zod), call one service function, send the response. No business rules.
   │
   ▼
service.js       Business rules and orchestration: pricing, holds, refunds, state changes, calling other modules.
   │
   ▼
repository.js    Database queries. The ONLY place that imports Mongoose models (enforced by ESLint).
   │
   ▼
models/          Mongoose schemas
```

Rules:

1. **Routes never query the database.** They call a service (or, for trivial reads, a repository of their own module).
2. **Only `repository.js` files import from `models/`.** ESLint fails the build otherwise (`no-restricted-imports`).
3. **Services may call other modules' services** (preferred) or their repositories for simple reads. Repositories never import services.
4. **A repository function names an intention** (`claimAsPaid`, `markInventoryReleased`), not a query shape. The business meaning stays in the service.
5. **State changes are atomic and guarded.** Booking status changes go through `bookings/repository.transition(filter, …)`, which only applies when the booking is still in the expected state. That is what makes retried webhooks and simultaneous requests safe.

## Folder map

```
src/
  app.js, server.js, config.js, db.js, jobs.js   Express app, startup, settings, DB connection, hold-expiry sweeper
  routes/admin.js                                Composes the admin API from the feature routers
  middleware/                                    auth (JWT), validation (zod), rate limiting, error handling
  models/                                        Mongoose schemas
  utils/                                         dates, money, pagination, errors, small helpers
  validation.js                                  Shared zod request schemas
  agent/                                         The AI receptionist (see below)
  modules/
    auth/            login, current user, admin users
    hotels/          property settings, agent API key
    rooms/           room types (what is sold) and physical rooms
    inventory/       atomic per-night room counters, availability grid, stop-sell
    bookings/        lifecycle (service), stay rules, availability search, pricing, audit history
    payments/        payment links and refunds (service), gateways (providers/), webhooks and test pay page
    guests/          guest profiles and stats
    calls/           call logs, callbacks (staff tasks), raiseStaffTask()
    notifications/   guest messages: templates, email and WhatsApp channels, message log
    analytics/       dashboard and analytics aggregations
    public/          unauthenticated property info for the guest website
```

Each module folder contains some of `routes.js`, `service.js`, `repository.js`, plus feature-specific files. Modules
without business rules (for example `notifications`) have no service.

## The agent module

Everything the AI receptionist needs is under `src/agent/`, behind `agent/index.js`:

| File | Purpose |
|---|---|
| `routes.js` | The HTTP API the agent uses as its tools (`/api/agent/*`), authenticated by API key |
| `auth.js` | Agent API-key authentication (per-hotel key, or master key + `x-hotel-id`) |
| `tools.js` | Tool definitions: what the agent may do, and which endpoint implements each |
| `prompt.js` | Persona, speaking style and rules. Tune the agent's behaviour here |
| `toolRunner.js` | Executes a tool call by calling the agent API |
| `liveAgent.js` | Real-time audio calls: WebSocket server bridging the browser and Gemini Live |
| `textAgent.js` | Turn-based text agent used by the admin "Talk to agent" tester |
| `gemini.js` | Gemini text client with rate-limit fallback between models |
| `callRecord.js` | Writes the call log: transcript, outcome, summary |
| `session.js` | State of one call (caller, tools used, bookings made) |
| `views.js` | Agent-friendly shapes of bookings and property facts |
| `adminRoutes.js` | Admin endpoints for the browser test call |

The agent changes hotel data only through its tools (the agent API), never by touching the database. See
[VOICE_AGENT.md](VOICE_AGENT.md) for how the real-time call works.

## Adding a feature

1. Create `src/modules/<feature>/` with `repository.js` (queries), `service.js` (rules) and `routes.js` (HTTP).
2. Mount the router in `src/routes/admin.js` (admin) or `src/app.js` (public).
3. Add zod schemas to `validation.js` or next to the route when they are specific to it.
4. Add a check to `backend/scripts/smoke.js`.

## Conventions

- ES modules, 2-space indent, single quotes, 140-column lines (Prettier: `npm run format`).
- `npm run lint` must pass (ESLint, including the layering rule). `npm test` must pass (25 end-to-end checks on a throwaway database).
- Errors: throw `ApiError` helpers from `utils/errors.js` (`badRequest`, `notFound`, `conflict`, ...); the error middleware turns them into `{ error: { code, message } }`.
- Comments explain *why* and document exported functions; they don't restate the code.
- Dates are `YYYY-MM-DD` strings in the property's timezone (`utils/dates.js`). Money is rounded with `round2`.
- Every record carries `hotel`, and every query is scoped to it (multi-tenant).
