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
    calls/           call logs, callbacks (staff tasks), raiseStaffTask(), closing calls left open by a crash
    conversations/   staff assistant chats (history), who may see whose
    notifications/   guest messages: templates, email and WhatsApp channels, message log
    analytics/       dashboard and analytics aggregations
    public/          unauthenticated property info for the guest website
```

Each module folder contains some of `routes.js`, `service.js`, `repository.js`, plus feature-specific files. Modules
without business rules (for example `notifications`) have no service.

## The agents

There are two AI agents with different users, permissions and tools, under `src/agent/` (entry point: `agent/index.js`).
They are built on **LangChain**: tools are LangChain tools with zod schemas, the staff assistant is a LangChain agent
(`createAgent`) with middleware, and call summaries use LangChain structured output.

```
agent/
  guest/    The receptionist guests talk to (website call, later phone). Books and manages the caller's own bookings.
  staff/    The assistant for signed-in hotel staff. Read-only answers about analytics, availability, bookings, ...
  shared/   model.js (LangChain chat models and fallbacks), schema.js (zod to provider JSON schema), language.js (language rules)
```

| Guest agent (`guest/`) | Purpose |
|---|---|
| `liveAgent.js` | Real-time audio calls: WebSocket server bridging the browser and Gemini Live (see "Where LangChain stops" below) |
| `tools.js` | The tool specs (zod schema + which `/api/agent` endpoint implements each). Single source of truth |
| `toolRunner.js` | `buildGuestTools`: LangChain tools bound to one call; fills in caller phone/email; logs every call with args, result and timing |
| `prompt.js` | Persona, speaking style and booking rules. Tune the receptionist here |
| `routes.js`, `auth.js` | The HTTP API the agent uses as its tools (`/api/agent/*`), authenticated by API key. `GET /api/agent/tools` serves the same specs to external agent runtimes |
| `callRecord.js`, `session.js` | Call log (transcript, outcome, grounded summary via structured output, language, errors) and per-call state |
| `views.js` | Agent-friendly shapes of bookings and property facts |

| Staff assistant (`staff/`) | Purpose |
|---|---|
| `assistant.js` | `runAssistant`: a LangChain agent with model fallbacks and a cap on tool rounds; `sendMessage` stores every exchange with the tool calls behind it |
| `tools.js` | 15 read-only tool specs (zod), built per conversation by `buildStaffTools(ctx, trace)` so each is bound to the user and property |
| `prompt.js`, `views.js` | Persona/rules, and compact shapes of data for the model |
| `routes.js` | `/api/admin/hotels/:hotelId/assistant/*`, any signed-in staff member, rate limited per user |

Rules for both agents: they change or read hotel data only through the same services and APIs the dashboard uses, never
through the database directly; tool failures come back as `{ error }` so the model can explain them; and everything they
do is recorded (guest calls in the call log, staff chats in `modules/conversations`) for history and debugging.

### How LangChain is used

- **Tools:** one zod schema per tool drives validation, the public tool list and the Gemini declarations (`shared/schema.js`
  strips what providers reject). Tools are built per call or conversation, so they carry their own context.
- **Model layer:** `shared/model.js` is the only file that knows the provider (Gemini via `@langchain/google-genai`). A primary
  model plus fallbacks (`GEMINI_MODEL`, `GEMINI_FALLBACK_MODELS`) and extra API keys (`GEMINI_API_KEY_2` to `_10`, rotated by `agent/shared/keys.js`; a voice call retries on the next key if one is out of quota) handle the small free-tier quotas; switching provider is a change there.
- **Staff assistant:** `createAgent` with `modelFallbackMiddleware` and `modelCallLimitMiddleware`. The stored conversation is the source
  of truth for context, so chats survive restarts and work across several server instances.
- **Summaries:** `model.withStructuredOutput(zod schema)`, grounded in the tool log so a summary never claims a booking that was not made.
- **Tests:** LangChain's `fakeModel` scripts the model, so the whole agent loop (tool calls, fallbacks, loop caps) is unit tested offline.

### Where LangChain stops

The live voice call streams audio both ways over a WebSocket to **Gemini Live**; the model, not our code, runs the conversation
loop, and LangChain's chat abstractions do not cover that realtime audio protocol. So `liveAgent.js` stays a thin native bridge,
but it still uses the LangChain tools (declarations are generated from them and every tool call executes through them).
If a text channel is added for guests (for example a WhatsApp bot), it can reuse the same guest tools with `createAgent`.

## Adding a feature

1. Create `src/modules/<feature>/` with `repository.js` (queries), `service.js` (rules) and `routes.js` (HTTP).
2. Mount the router in `src/routes/admin.js` (admin) or `src/app.js` (public).
3. Add zod schemas to `validation.js` or next to the route when they are specific to it.
4. Add a check to `backend/scripts/smoke.js`.

## Conventions

- ES modules, 2-space indent, single quotes, 140-column lines (Prettier: `npm run format`).
- `npm run lint` must pass (ESLint, including the layering rule). `npm test` must pass: unit tests, then the end-to-end suite.
- Errors: throw `ApiError` helpers from `utils/errors.js` (`badRequest`, `notFound`, `conflict`, ...); the error middleware turns them into `{ error: { code, message } }`.
- Comments explain *why* and document exported functions; they don't restate the code.
- Dates are `YYYY-MM-DD` strings in the property's timezone (`utils/dates.js`). Money is rounded with `round2`.
- Every record carries `hotel`, and every query is scoped to it (multi-tenant).

## Testing

| Command | What it runs |
|---|---|
| `npm run test:unit` | Fast unit tests (`backend/test/unit`, Node's built-in test runner, no database, no network, no API keys) |
| `npm run smoke` | End-to-end suite (`scripts/smoke.js`, 28 checks): the real API against a throwaway database, including race conditions, holds expiring, refunds, tenant isolation and the staff assistant's tools and permissions |
| `npm test` | Both |
| `npm run test:coverage` | Unit tests with a coverage table |

Unit tests cover the logic that does not need a database: pricing, stay rules, cancellation policy, validation, message
templates, email rendering, agent tool definitions, prompts and the staff assistant's data shaping. `test/setup.js` pins the
environment (no real emails or keys) so results do not depend on a developer's `.env`. Business workflows that need the
database (booking creation, payment outcomes, inventory races) are covered by the end-to-end suite. Add a unit test next to
any new pure logic and a step to `smoke.js` for any new endpoint.
