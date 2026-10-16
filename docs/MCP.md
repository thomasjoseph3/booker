# MCP server

The hotel's tools are offered by one **MCP server** that runs as its own process (`npm run mcp`, port 4001, this
machine only). It is the only way the voice agent and the staff assistant reach the tools, and outside MCP clients
(Claude Desktop, Claude Code, other agents) can use it too.

```
caller ── voice agent (Gemini Live) ──┐
staff ─── admin assistant ────────────┤
                                      ├─►  MCP server :4001  ──►  hotel API :4000  ──►  database
Claude Desktop / Claude Code / other ─┘     the tools live here;
                                            checks who is calling, logs every call
```

## Where the tools are written
The tools are written in the MCP code, in `backend/src/mcp/tools/`:

| File | What it holds |
|---|---|
| `tools/guest.js` | The receptionist's tools: name, description, inputs, and which `/api/agent` endpoint does the work |
| `tools/staff.js` | The staff assistant's read-only tools, with the code that answers them (`tools/staffViews.js` shapes the results) |
| `servers.js` | Publishes both lists as MCP servers and runs the calls |

Nobody else keeps a copy. The voice agent and the staff assistant ask the server what tools exist (`tools/list`), hand that
list to the model, and send every tool call back to the server. To add a tool, write it in `tools/guest.js` or
`tools/staff.js`; it then shows up for the voice agent, the staff assistant and outside clients.

Only `end_call` is not an MCP tool: it hangs up the call, so the live call handles it (`agent/guest/callControl.js`).

The booking rules themselves stay in the hotel API and its services. The MCP tools call them and add the checks, so a
rule exists once and the admin screens use the same one.

## Why it is safer
- **The voice agent holds no API key.** The MCP server holds `AGENT_MASTER_KEY`. The voice agent only has a signed
  token for the current call.
- **The model cannot choose who the caller is.** The token names the hotel, the call and the caller's phone and email.
  The MCP server fills them in itself and ignores anything the model says about them: the booking always belongs to
  the caller's number and is tied to this call, even if the model names another call.
- **Short-lived tokens.** A call token expires a few minutes after the longest allowed call. It is useless for
  anything else: it is not a login token, and a login token is not a call token.
- **Every request is checked and logged.** One line per tool call (hotel, call, tool, ok, time, never the arguments),
  rate limited per credential. The MCP server listens on `127.0.0.1` unless you change `MCP_HOST`.
- If the MCP server is down, a call is refused at the start with a clear error in its call log, not half way through.

## Run it
`npm run dev` starts it with the rest. On its own: `npm run mcp` (or `npm run mcp:dev` to restart on changes).
Settings in `backend/.env`: `MCP_PORT`, `MCP_HOST`, `MCP_SECRET` (signs call tokens; if empty a key derived from
`JWT_SECRET` is used, so set it explicitly in production), `AGENT_MASTER_KEY`.

## Outside clients

| Endpoint | Sign in with | Tools |
|---|---|---|
| `POST /mcp/booking` | `x-api-key`: the hotel's agent key (Settings in the admin) | The receptionist's: rooms, prices, special rates, book, change, cancel, callbacks |
| `POST /mcp/staff/<hotelId>` | `Authorization: Bearer <login token>` | Read-only: overview, analytics, bookings, rooms, calls, payments, guests |

Both are stateless HTTP (POST only). A staff token only opens the properties that user can access.

### Claude Code
```bash
# staff questions (read-only)
npm run mcp:token -- manager@lakesidepalms.local 30      # prints a token and the URL
claude mcp add --transport http hotel-staff http://localhost:4001/mcp/staff/<hotelId> \
  --header "Authorization: Bearer <token>"

# booking tools (they can create and cancel real bookings)
claude mcp add --transport http hotel-booking http://localhost:4001/mcp/booking \
  --header "x-api-key: <hotel agent key>"
```
Then ask, for example, "who is arriving tomorrow?" or "what are the rates for 20-24 December?".

Treat the token and the agent key like passwords. A new agent key generated in the admin replaces the old one. The
booking tools change real data, so give that key only to clients you trust.

## The staff assistant
Inside the admin, the assistant signs in to the staff server as the logged-in staff member, with a login token made for
that one question that lasts five minutes. If the MCP server is down it says the tools server is not reachable.
