import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { agentTools, geminiFunctionDeclarations, toolByName } from '../../src/agent/guest/tools.js';
import { runStaffTool, staffFunctionDeclarations, staffTools } from '../../src/agent/staff/tools.js';
import { hotel } from '../fixtures/hotel.js';

describe('guest agent tools', () => {
  it('has unique names and a valid HTTP mapping for each tool', () => {
    const names = agentTools.map((t) => t.function.name);
    assert.equal(new Set(names).size, names.length);
    for (const t of agentTools) {
      assert.match(t.http.method, /^(GET|POST|PATCH)$/, t.function.name);
      assert.match(t.http.path, /^\/api\/agent\//, t.function.name);
      assert.ok(t.function.description.length > 20, `${t.function.name} needs a useful description`);
    }
  });

  it('declares every required parameter and every path parameter', () => {
    for (const { function: f, http } of agentTools) {
      const props = Object.keys(f.parameters.properties);
      for (const r of f.parameters.required) assert.ok(props.includes(r), `${f.name}: required "${r}" is not declared`);
      for (const [, p] of http.path.matchAll(/\{(\w+)\}/g)) assert.ok(props.includes(p), `${f.name}: path needs "${p}"`);
    }
  });

  it('offers the booking lifecycle: look up, book, change, cancel, hand off', () => {
    for (const name of [
      'check_availability',
      'create_booking',
      'find_bookings',
      'modify_booking',
      'cancel_booking',
      'request_human_callback',
    ]) {
      assert.ok(toolByName[name], name);
    }
  });

  it('never gives Gemini an empty parameters object (it rejects those)', () => {
    for (const d of geminiFunctionDeclarations) {
      if (d.parameters) assert.ok(Object.keys(d.parameters.properties).length > 0, d.name);
    }
    assert.equal(geminiFunctionDeclarations.find((d) => d.name === 'get_hotel_info').parameters, undefined);
  });
});

describe('staff assistant tools', () => {
  it('has unique names, descriptions, and consistent required parameters', () => {
    const names = staffTools.map((t) => t.name);
    assert.equal(new Set(names).size, names.length);
    for (const t of staffTools) {
      assert.ok(t.description.length > 20, t.name);
      for (const r of t.required) assert.ok(r in t.properties, `${t.name}: required "${r}" is not declared`);
    }
    assert.equal(staffFunctionDeclarations.length, staffTools.length);
  });

  it('is read-only: no tool name suggests a write', () => {
    for (const t of staffTools) assert.doesNotMatch(t.name, /^(create|update|delete|cancel|set|modify|refund|check_in|check_out)/, t.name);
  });

  it('returns errors instead of throwing, so the model can explain them', async () => {
    const ctx = { hotel, user: { name: 'T', role: 'hotel_admin' } };
    assert.match((await runStaffTool(ctx, 'does_not_exist')).error, /Unknown tool/);
    const bad = await runStaffTool(ctx, 'check_availability', { checkIn: 'soon', checkOut: 'later' });
    assert.match(bad.error, /YYYY-MM-DD/);
  });
});
