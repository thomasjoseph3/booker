import { createAgent, modelCallLimitMiddleware, modelFallbackMiddleware } from 'langchain';
import { config } from '../../config.js';
import { getChat, getWritableChat, recordExchange, startChat } from '../../modules/conversations/service.js';
import { createModels, toApiError } from '../shared/model.js';
import { buildStaffPrompt } from './prompt.js';
import { buildStaffTools } from './tools.js';

/**
 * The assistant for hotel staff, built on LangChain: a tool-calling agent (`createAgent`) with read-only tools,
 * model fallbacks and a cap on tool rounds. Every exchange, with the tool calls behind each answer, is stored in the
 * conversation for history and debugging. The stored messages are the source of truth for context, so conversations
 * survive restarts and work across several server instances.
 */

const MAX_MODEL_CALLS = 8; // tool rounds in one answer
const HISTORY_LIMIT = 30; // earlier messages sent to the model
const STUCK = 'I got stuck looking that up. Could you rephrase or narrow the question?';
const LIMIT_REACHED = /call limits? exceeded/i; // what the call-limit middleware says when it stops a looping model

export { getChat, startChat };

/**
 * Runs the agent on `history` plus the new question and returns the final answer. A pure function of its inputs
 * (model, tools, prompt), so it can be tested with a fake model.
 * @param {{primary: object, fallbacks?: object[]}} models
 * @param {{role: string, content: string}[]} messages Earlier turns followed by the new question
 * @returns {Promise<string>}
 */
export async function runAssistant({ models, tools, systemPrompt, messages }) {
  const agent = createAgent({
    model: models.primary,
    tools,
    systemPrompt,
    middleware: [modelFallbackMiddleware(...(models.fallbacks ?? [])), modelCallLimitMiddleware({ runLimit: MAX_MODEL_CALLS })],
  });
  // Each model call is several graph steps once middleware is involved; give the graph room so the call cap is what stops a loop.
  const result = await agent.invoke({ messages }, { recursionLimit: MAX_MODEL_CALLS * 8 });
  const answer = result.messages.at(-1)?.text?.trim();
  return !answer || LIMIT_REACHED.test(answer) ? STUCK : answer;
}

/**
 * Sends the user's message and returns the reply. Both are stored in the conversation, and so is any failure.
 * @returns {Promise<{reply: string, tools: object[]}>}
 */
export async function sendMessage(hotel, user, chatId, text, models = createModels({ temperature: 0.3, maxOutputTokens: 1200 })) {
  const chat = await getWritableChat(hotel, user, chatId);
  const history = chat.messages.filter((m) => m.role !== 'system').slice(-HISTORY_LIMIT);
  const userMessage = { role: 'user', text, at: new Date() };
  const trace = [];
  const started = Date.now();

  try {
    const reply = await runAssistant({
      models,
      tools: buildStaffTools({ hotel, user }, trace),
      systemPrompt: buildStaffPrompt(hotel, user),
      messages: [...history.map((m) => ({ role: m.role, content: m.text })), { role: 'user', content: text }],
    });
    const assistantMessage = {
      role: 'assistant',
      text: reply,
      at: new Date(),
      tools: trace,
      model: config.gemini.models[0],
      ms: Date.now() - started,
    };
    await recordExchange(chat, [userMessage, assistantMessage]);
    return { reply, tools: trace };
  } catch (e) {
    const error = toApiError(e);
    await recordExchange(chat, [
      userMessage,
      { role: 'system', text: `Assistant error: ${error.message}`, at: new Date(), tools: trace, ms: Date.now() - started },
    ]);
    throw error;
  }
}
