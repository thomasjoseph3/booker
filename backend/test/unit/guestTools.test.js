import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';
import { buildGuestTools, invokeGuestTool } from '../../src/agent/guest/toolRunner.js';
import { createSession } from '../../src/agent/guest/session.js';
import { hotel } from '../fixtures/hotel.js';

// The tools run on the MCP server. Here the MCP client and the call log are replaced, so no server or database is needed.
// (What the MCP server adds to each call is covered in mcp.test.js.)
describe('guest tools (LangChain) used by the live call', () => {
  let calls;
  let logged;
  let reply;
  let session;
  let tools;

  const fakeClient = {
    callTool: async (request) => {
      calls.push(request);
      return reply();
    },
  };
  const ok = (data) => ({ content: [{ type: 'text', text: JSON.stringify(data) }] });
  const failed = (data) => ({ isError: true, content: [{ type: 'text', text: typeof data === 'string' ? data : JSON.stringify(data) }] });

  beforeEach(() => {
    calls = [];
    logged = [];
    reply = () => ok({ ok: true });
    session = createSession({ callerPhone: '+919847012345', callerEmail: 'asha@example.com' });
    tools = buildGuestTools(
      { session, hotel, callId: 'web-1' },
      { client: fakeClient, log: async (hotelId, callId, entries) => logged.push({ hotelId, callId, entries }) },
    );
  });

  it('runs a tool on the MCP server by name, with exactly the arguments the model gave', async () => {
    reply = () => ok({ options: [] });
    const args = { checkIn: '2026-12-10', checkOut: '2026-12-12', adults: 2 };
    const result = await invokeGuestTool(tools, 'check_availability', args);
    assert.deepEqual(result, { options: [] });
    assert.deepEqual(calls, [{ name: 'check_availability', arguments: args }]);
  });

  it('adds nothing about the caller itself: the MCP server does that from the call token', async () => {
    await invokeGuestTool(tools, 'find_bookings', {});
    await invokeGuestTool(tools, 'create_booking', {
      roomTypeId: 'rt1',
      checkIn: '2026-12-10',
      checkOut: '2026-12-12',
      adults: 2,
      guest: { name: 'Asha' },
    });
    assert.deepEqual(calls[0].arguments, {});
    assert.deepEqual(calls[1].arguments.guest, { name: 'Asha' });
    assert.equal(calls[1].arguments.callId, undefined);
  });

  it('remembers what was done and the booking made', async () => {
    reply = () => ok({ booking: { code: 'BKABC123' }, sayNext: 'ok' });
    await invokeGuestTool(tools, 'create_booking', {
      roomTypeId: 'rt1',
      checkIn: '2026-12-10',
      checkOut: '2026-12-12',
      adults: 2,
      guest: { name: 'Asha' },
    });
    assert.ok(session.tools.has('create_booking'));
    assert.ok(session.bookingCodes.has('BKABC123'));
  });

  it('records every tool call in the call log with its arguments, outcome and timing', async () => {
    reply = () => ok({ ok: 1 });
    await invokeGuestTool(tools, 'list_room_types', {});
    assert.equal(logged.length, 1);
    const entry = logged[0].entries[0];
    assert.equal(logged[0].callId, 'web-1');
    assert.equal(entry.role, 'tool');
    assert.match(entry.text, /^list_room_types → ok \(\d+ ms\)$/);
    assert.deepEqual([entry.data.name, entry.data.ok], ['list_room_types', true]);
  });

  it('returns tool errors to the model instead of throwing, and does not count them as done', async () => {
    reply = () => failed({ error: 'Booking not found', details: { code: 'x' } });
    const result = await invokeGuestTool(tools, 'find_bookings', { code: 'NOPE' });
    assert.equal(result.error, 'Booking not found');
    assert.equal(session.tools.has('find_bookings'), false);
    assert.equal(logged[0].entries[0].data.ok, false);
    assert.match(logged[0].entries[0].text, /ERROR Booking not found/);
  });

  it('turns a plain-text error from the MCP server (such as bad arguments) into an error result', async () => {
    reply = () => failed('MCP error -32602: Input validation error');
    assert.match((await invokeGuestTool(tools, 'find_bookings', {})).error, /Input validation error/);
  });

  it('survives the MCP server being unreachable', async () => {
    reply = () => {
      throw new Error('connect ECONNREFUSED');
    };
    assert.match((await invokeGuestTool(tools, 'get_hotel_info', {})).error, /ECONNREFUSED/);
  });

  it('rejects unknown tools and invalid arguments without calling the MCP server', async () => {
    assert.match((await invokeGuestTool(tools, 'delete_everything', {})).error, /Unknown tool/);
    assert.ok((await invokeGuestTool(tools, 'check_availability', { checkIn: '2026-12-10' })).error, 'missing checkOut and adults');
    assert.equal(calls.length, 0);
  });
});
