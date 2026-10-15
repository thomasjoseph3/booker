import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';
import { buildGuestTools, invokeGuestTool } from '../../src/agent/guest/toolRunner.js';
import { createSession } from '../../src/agent/guest/session.js';
import { hotel } from '../fixtures/hotel.js';

// The tools call the agent's own HTTP API. Here fetch and the call log are replaced, so no server or database is needed.
describe('guest tools (LangChain) used by the live call', () => {
  let requests;
  let logged;
  let reply;
  let session;
  let tools;

  const fakeFetch = async (url, init) => {
    requests.push({ url: new URL(url), method: init.method, headers: init.headers, body: init.body ? JSON.parse(init.body) : undefined });
    return reply();
  };
  const json = (status, body) => ({ ok: status < 400, status, json: async () => body });

  beforeEach(() => {
    requests = [];
    logged = [];
    reply = () => json(200, { ok: true });
    session = createSession({ callerPhone: '+919847012345', callerEmail: 'asha@example.com' });
    tools = buildGuestTools(
      { session, hotel, callId: 'web-1' },
      { fetch: fakeFetch, log: async (hotelId, callId, entries) => logged.push({ hotelId, callId, entries }) },
    );
  });

  it('calls the agent API for the right hotel and call', async () => {
    reply = () => json(200, { options: [] });
    const result = await invokeGuestTool(tools, 'check_availability', { checkIn: '2026-12-10', checkOut: '2026-12-12', adults: 2 });
    assert.deepEqual(result, { options: [] });
    const [r] = requests;
    assert.equal(r.method, 'POST');
    assert.equal(r.url.pathname, '/api/agent/availability');
    assert.equal(r.headers['x-hotel-id'], 'h1');
    assert.equal(r.headers['x-call-id'], 'web-1');
    assert.deepEqual(r.body, { checkIn: '2026-12-10', checkOut: '2026-12-12', adults: 2 });
  });

  it("fills in the caller's phone when the model leaves it out", async () => {
    await invokeGuestTool(tools, 'find_bookings', {});
    assert.equal(requests[0].method, 'GET');
    assert.equal(requests[0].url.searchParams.get('phone'), '+919847012345');
    await invokeGuestTool(tools, 'find_bookings', { phone: '+911111111111' });
    assert.equal(requests[1].url.searchParams.get('phone'), '+911111111111', 'a number the caller gave wins');
  });

  it("books with the caller's phone and email, tags the call, and remembers the booking", async () => {
    reply = () => json(201, { booking: { code: 'BKABC123' }, sayNext: 'ok' });
    await invokeGuestTool(tools, 'create_booking', {
      roomTypeId: 'rt1',
      checkIn: '2026-12-10',
      checkOut: '2026-12-12',
      adults: 2,
      guest: { name: 'Asha' },
    });
    assert.deepEqual(requests[0].body.guest, { phone: '+919847012345', email: 'asha@example.com', name: 'Asha' });
    assert.equal(requests[0].body.callId, 'web-1');
    assert.ok(session.tools.has('create_booking'));
    assert.ok(session.bookingCodes.has('BKABC123'));
  });

  it('puts path parameters into the URL', async () => {
    await invokeGuestTool(tools, 'cancel_booking', { code: 'BK1', reason: 'plans changed' });
    assert.equal(requests[0].url.pathname, '/api/agent/bookings/BK1/cancel');
    assert.equal(requests[0].method, 'POST');
    assert.equal(requests[0].body.phone, '+919847012345');
  });

  it('records every tool call in the call log with its arguments, outcome and timing', async () => {
    reply = () => json(200, { ok: 1 });
    await invokeGuestTool(tools, 'list_room_types', {});
    assert.equal(logged.length, 1);
    const entry = logged[0].entries[0];
    assert.equal(logged[0].callId, 'web-1');
    assert.equal(entry.role, 'tool');
    assert.match(entry.text, /^list_room_types → ok \(\d+ ms\)$/);
    assert.deepEqual([entry.data.name, entry.data.ok], ['list_room_types', true]);
  });

  it('returns API errors to the model instead of throwing, and does not count them as done', async () => {
    reply = () => json(404, { error: { message: 'Booking not found', details: { code: 'x' } } });
    const result = await invokeGuestTool(tools, 'find_bookings', { code: 'NOPE' });
    assert.equal(result.error, 'Booking not found');
    assert.equal(session.tools.has('find_bookings'), false);
    assert.equal(logged[0].entries[0].data.ok, false);
    assert.match(logged[0].entries[0].text, /ERROR Booking not found/);
  });

  it('survives the network failing', async () => {
    reply = () => {
      throw new Error('connect ECONNREFUSED');
    };
    assert.match((await invokeGuestTool(tools, 'get_hotel_info', {})).error, /ECONNREFUSED/);
  });

  it('rejects unknown tools and invalid arguments without calling the API', async () => {
    assert.match((await invokeGuestTool(tools, 'delete_everything', {})).error, /Unknown tool/);
    assert.ok((await invokeGuestTool(tools, 'check_availability', { checkIn: '2026-12-10' })).error, 'missing checkOut and adults');
    assert.equal(requests.length, 0);
  });
});
