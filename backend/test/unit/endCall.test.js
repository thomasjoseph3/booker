import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildGuestTools, invokeGuestTool } from '../../src/agent/guest/toolRunner.js';
import { agentTools } from '../../src/agent/guest/tools.js';

test('end_call is a tool for the live call but is not in the public HTTP tool list', async () => {
  const tools = buildGuestTools({ session: {}, hotel: { _id: 'h1' }, callId: 'c1' }, { log: async () => {} });
  assert.ok(tools.some((t) => t.name === 'end_call'));
  assert.ok(!agentTools.some((t) => t.function.name === 'end_call'));
  const result = await invokeGuestTool(tools, 'end_call', {});
  assert.equal(result.ok, true);
});
