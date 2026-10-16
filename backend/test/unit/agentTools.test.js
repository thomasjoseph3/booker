import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { geminiDeclarations, toJsonSchema } from '../../src/agent/shared/schema.js';
import { createBookingServer, createStaffServer } from '../../src/mcp/servers.js';
import { agentTools, guestToolSpecs } from '../../src/mcp/tools/guest.js';
import { runStaffTool, staffToolSpecs } from '../../src/mcp/tools/staff.js';
import { hotel } from '../fixtures/hotel.js';

/** The tool list as a client sees it: connects to a real MCP server in memory and asks tools/list. */
async function listFrom(server) {
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await server.connect(serverSide);
  const client = new Client({ name: 'test', version: '1' });
  await client.connect(clientSide);
  const { tools } = await client.listTools();
  await client.close();
  return tools;
}

const FORBIDDEN_KEYS = ['$schema', 'additionalProperties', 'default'];
const keysOf = (node, found = new Set()) => {
  if (Array.isArray(node)) node.forEach((n) => keysOf(n, found));
  else if (node && typeof node === 'object') for (const [k, v] of Object.entries(node)) (found.add(k), keysOf(v, found));
  return found;
};

describe('guest agent tool specs', () => {
  it('has unique names, useful descriptions and a valid HTTP mapping', () => {
    const names = guestToolSpecs.map((s) => s.name);
    assert.equal(new Set(names).size, names.length);
    for (const s of guestToolSpecs) {
      assert.match(s.http.method, /^(GET|POST|PATCH)$/, s.name);
      assert.match(s.http.path, /^\/api\/agent\//, s.name);
      assert.ok(s.description.length > 20, `${s.name} needs a useful description`);
    }
  });

  it('declares every path parameter in the schema', () => {
    for (const s of guestToolSpecs) {
      for (const [, p] of s.http.path.matchAll(/\{(\w+)\}/g)) assert.ok(p in s.schema.shape, `${s.name}: path needs "${p}"`);
    }
  });

  it('offers the booking lifecycle: look up, book, change, cancel, hand off', () => {
    const names = guestToolSpecs.map((s) => s.name);
    for (const n of [
      'check_availability',
      'create_booking',
      'find_bookings',
      'modify_booking',
      'cancel_booking',
      'request_human_callback',
    ]) {
      assert.ok(names.includes(n), n);
    }
  });

  it('publishes clean OpenAI-style definitions for external agent runtimes', () => {
    for (const t of agentTools) {
      assert.equal(t.type, 'function');
      for (const k of FORBIDDEN_KEYS) assert.ok(!keysOf(t.function.parameters).has(k), `${t.function.name} must not contain "${k}"`);
    }
    const booking = agentTools.find((t) => t.function.name === 'create_booking').function.parameters;
    assert.deepEqual(booking.required.sort(), ['adults', 'checkIn', 'checkOut', 'guest', 'roomTypeId']);
    assert.ok(!booking.required.includes('callId'));
  });

  it("never requires the caller's phone: the agent fills it in from caller ID", () => {
    for (const t of agentTools) assert.ok(!(t.function.parameters.required ?? []).includes('phone'), t.function.name);
  });
});

describe('Gemini declarations (from what the MCP server lists)', () => {
  let declarations;
  it('are built from tools/list', async () => {
    const tools = await listFrom(createBookingServer({ headers: {} }));
    assert.deepEqual(tools.map((t) => t.name).sort(), guestToolSpecs.map((t) => t.name).sort());
    declarations = geminiDeclarations(tools);
  });

  it('omits parameters for tools without arguments (Gemini rejects an empty object)', () => {
    assert.equal(declarations.find((d) => d.name === 'get_hotel_info').parameters, undefined);
    assert.ok(declarations.find((d) => d.name === 'check_availability').parameters.properties.checkIn);
  });

  it('removes the keys Gemini does not accept, including integer bounds', () => {
    for (const d of declarations) {
      for (const k of FORBIDDEN_KEYS) assert.ok(!keysOf(d.parameters ?? {}).has(k), `${d.name}: "${k}"`);
      assert.ok(!JSON.stringify(d.parameters ?? {}).includes('9007199254740991'), `${d.name}: safe-integer bounds`);
    }
  });

  it('describes a plain object schema in JSON schema form', () => {
    const schema = toJsonSchema(guestToolSpecs.find((s) => s.name === 'check_availability').schema);
    assert.equal(schema.type, 'object');
    assert.equal(schema.properties.adults.type, 'integer');
    assert.deepEqual(schema.required.sort(), ['adults', 'checkIn', 'checkOut']);
  });
});

describe('staff assistant tool specs', () => {
  it('has unique names and descriptions', () => {
    const names = staffToolSpecs.map((s) => s.name);
    assert.equal(new Set(names).size, names.length);
    for (const s of staffToolSpecs) assert.ok(s.description.length > 20, s.name);
  });

  it('is read-only: no tool name suggests a write', () => {
    for (const s of staffToolSpecs)
      assert.doesNotMatch(s.name, /^(create|update|delete|cancel|set|modify|refund|check_in|check_out)/, s.name);
  });

  it('exposes clean schemas to the model, as the MCP server lists them', async () => {
    const tools = await listFrom(createStaffServer({ hotel, user: { role: 'hotel_admin' } }));
    assert.deepEqual(tools.map((t) => t.name).sort(), staffToolSpecs.map((t) => t.name).sort());
    for (const d of geminiDeclarations(tools))
      for (const k of FORBIDDEN_KEYS) assert.ok(!keysOf(d.parameters ?? {}).has(k), `${d.name}: "${k}"`);
  });

  it('returns errors instead of throwing, so the model can explain them', async () => {
    const ctx = { hotel, user: { name: 'T', role: 'hotel_admin' } };
    assert.match((await runStaffTool(ctx, 'does_not_exist')).error, /Unknown tool/);
    assert.match((await runStaffTool(ctx, 'check_availability', {})).error, /checkIn/, 'missing arguments are reported');
    assert.match((await runStaffTool(ctx, 'check_availability', { checkIn: 'soon', checkOut: 'later' })).error, /YYYY-MM-DD/);
  });
});
