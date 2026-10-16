# MCP servers

The hotel's tools are also offered over [MCP](https://modelcontextprotocol.io), so outside clients (Claude Desktop,
Claude Code, other agents) can use them. The live voice call does **not** use MCP; it keeps calling the tools directly.

The tools are defined once (`backend/src/agent/guest/tools.js`, `backend/src/agent/staff/tools.js`). A tool added there
shows up in MCP too. The MCP code is in `backend/src/mcp/`.

| Server | URL | Sign in with | Tools |
|---|---|---|---|
| Booking | `POST /mcp/booking` | `x-api-key`: the hotel's agent key (Settings in the admin) | The receptionist's: rooms, prices, special rates, book, change, cancel, callbacks |
| Staff | `POST /mcp/staff/<hotelId>` | `Authorization: Bearer <login token>` | Read-only: overview, analytics, bookings, rooms, calls, payments, guests |

Both are stateless HTTP (POST only). The booking server forwards each call to the normal `/api/agent` endpoints, so
the same validation and hotel scoping apply. A staff token only opens the properties that user can access.

## Connect Claude Code

```bash
# staff questions (read-only)
npm run mcp:token -- manager@lakesidepalms.local 30      # prints a token and the URL
claude mcp add --transport http hotel-staff http://localhost:4000/mcp/staff/<hotelId> \
  --header "Authorization: Bearer <token>"

# booking tools (they can create and cancel real bookings)
claude mcp add --transport http hotel-booking http://localhost:4000/mcp/booking \
  --header "x-api-key: <hotel agent key>"
```

Then ask, for example, "who is arriving tomorrow?" or "what are the rates for 20-24 December?".

## Safety
- Treat the token and the agent key like passwords. Generating a new agent key in the admin replaces the old one.
- The booking tools change real data. Give that key only to clients you trust.
- Requests are limited to 120 per minute per credential.
