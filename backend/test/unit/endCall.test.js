import assert from 'node:assert/strict';
import { test } from 'node:test';
import { endCallTool } from '../../src/agent/guest/callControl.js';
import { buildGuestTools, invokeGuestTool } from '../../src/agent/guest/toolRunner.js';
import { agentTools, guestToolSpecs } from '../../src/mcp/tools/guest.js';

test('end_call is handled by the live call itself: always offered to the model, never an MCP or HTTP tool', async () => {
  const tools = buildGuestTools({ session: {}, hotel: { _id: 'h1' }, callId: 'c1' }, { log: async () => {} });
  assert.ok(tools.some((t) => t.name === 'end_call'));
  assert.ok(!agentTools.some((t) => t.function.name === 'end_call'));
  assert.ok(!guestToolSpecs.some((t) => t.name === 'end_call'), 'the MCP server does not offer it');
  assert.equal(endCallTool.name, 'end_call');
  const result = await invokeGuestTool(tools, 'end_call', {});
  assert.equal(result.ok, true);
});
