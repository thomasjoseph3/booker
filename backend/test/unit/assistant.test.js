import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { AIMessage, fakeModel } from 'langchain';
import { z } from 'zod';
import { runAssistant } from '../../src/agent/staff/assistant.js';
import { toApiError } from '../../src/agent/shared/model.js';
import { buildStaffTools } from '../../src/agent/staff/tools.js';
import { ApiError, badRequest } from '../../src/utils/errors.js';
import { hotel } from '../fixtures/hotel.js';

const ctx = { hotel, user: { name: 'Anu', role: 'hotel_admin' } };
const spec = (name, run, schema = z.object({})) => ({ name, description: `Test tool ${name} used for checking behaviour`, schema, run });
const ask = (text) => [{ role: 'user', content: text }];

// A scripted model stands in for Gemini, so the whole agent loop is tested without a network.
describe('staff assistant loop (LangChain agent)', () => {
  it('lets the model call a tool, then answers from the result, and traces the call', async () => {
    const trace = [];
    const tools = buildStaffTools(ctx, trace, [spec('get_overview', async () => ({ arrivals: 0 }))]);
    const model = fakeModel()
      .respondWithTools([{ name: 'get_overview', args: {} }])
      .respond(new AIMessage('A quiet day: no arrivals.'));
    const answer = await runAssistant({
      models: { primary: model },
      tools,
      systemPrompt: 'You help staff.',
      messages: ask('How is today?'),
    });

    assert.equal(answer, 'A quiet day: no arrivals.');
    assert.equal(trace.length, 1);
    assert.deepEqual([trace[0].name, trace[0].ok], ['get_overview', true]);
    assert.equal(trace[0].result, '{"arrivals":0}');
    assert.ok(trace[0].ms >= 0);
  });

  it('passes the model its arguments, validated against the tool schema', async () => {
    const trace = [];
    const seen = [];
    const tools = buildStaffTools(ctx, trace, [
      spec('get_analytics', async (_ctx, args) => (seen.push(args), { ok: 1 }), z.object({ days: z.coerce.number().int().optional() })),
    ]);
    const model = fakeModel()
      .respondWithTools([{ name: 'get_analytics', args: { days: '7' } }])
      .respond(new AIMessage('done'));
    await runAssistant({ models: { primary: model }, tools, systemPrompt: 's', messages: ask('week?') });
    assert.deepEqual(seen, [{ days: 7 }], 'string "7" is coerced to the number 7');
  });

  it('keeps going when a tool fails: the error is traced and given to the model', async () => {
    const trace = [];
    const tools = buildStaffTools(ctx, trace, [
      spec('get_booking', async () => {
        throw badRequest('Booking not found');
      }),
    ]);
    const model = fakeModel()
      .respondWithTools([{ name: 'get_booking', args: {} }])
      .respond(new AIMessage('I could not find that booking.'));
    const answer = await runAssistant({ models: { primary: model }, tools, systemPrompt: 's', messages: ask('BK0?') });
    assert.equal(answer, 'I could not find that booking.');
    assert.deepEqual([trace[0].ok, trace[0].error], [false, 'Booking not found']);
  });

  it('falls back to the next model when the first one is rate limited', async () => {
    const primary = fakeModel().alwaysThrow(new Error('429 You exceeded your current quota'));
    const fallback = fakeModel().respond(new AIMessage('Answered by the fallback model.'));
    const answer = await runAssistant({ models: { primary, fallbacks: [fallback] }, tools: [], systemPrompt: 's', messages: ask('hi') });
    assert.equal(answer, 'Answered by the fallback model.');
  });

  it('fails when every model fails, so the caller can record the error', async () => {
    const down = () => fakeModel().alwaysThrow(new Error('503 high demand'));
    await assert.rejects(
      runAssistant({ models: { primary: down(), fallbacks: [down()] }, tools: [], systemPrompt: 's', messages: ask('hi') }),
      /503/,
    );
  });

  it('stops a model that keeps calling tools forever, with a message a person can read', async () => {
    const tools = buildStaffTools(ctx, [], [spec('get_overview', async () => ({}))]);
    const loop = fakeModel();
    for (let i = 0; i < 12; i++) loop.respondWithTools([{ name: 'get_overview', args: {}, id: `call-${i}` }]);
    const answer = await runAssistant({ models: { primary: loop }, tools, systemPrompt: 's', messages: ask('loop') });
    assert.match(answer, /got stuck/i);
    assert.doesNotMatch(answer, /limits exceeded/i);
  });

  it('sends the earlier conversation to the model', async () => {
    let received;
    const model = fakeModel().respond((messages) => ((received = messages), new AIMessage('ok')));
    await runAssistant({
      models: { primary: model },
      tools: [],
      systemPrompt: 'Be brief.',
      messages: [
        { role: 'user', content: 'How many rooms are free?' },
        { role: 'assistant', content: '15 rooms.' },
        { role: 'user', content: 'And tomorrow?' },
      ],
    });
    const text = received.map((m) => m.text);
    assert.deepEqual(text, ['Be brief.', 'How many rooms are free?', '15 rooms.', 'And tomorrow?']);
  });
});

describe('model errors', () => {
  it('explains rate limits clearly and keeps other API errors as they are', () => {
    const limited = toApiError(new Error('429 Too Many Requests: quota exceeded'));
    assert.deepEqual([limited.status, limited.code], [429, 'LLM_RATE_LIMITED']);
    assert.match(limited.message, /enable billing/);
    const generic = toApiError(new Error('socket hang up'));
    assert.deepEqual([generic.status, generic.code], [502, 'LLM_ERROR']);
    const own = badRequest('x');
    assert.equal(toApiError(own), own);
    assert.ok(toApiError('boom') instanceof ApiError);
  });
});
