import { config } from '../../config.js';
import { getChat, getWritableChat, recordExchange, startChat } from '../../modules/conversations/service.js';
import { generateContent } from '../shared/gemini.js';
import { buildStaffPrompt } from './prompt.js';
import { runStaffTool, staffFunctionDeclarations } from './tools.js';

/**
 * Turn-based assistant for hotel staff (Gemini function calling over read-only tools).
 * Every exchange, with the tool calls behind each answer, is stored in the conversation for history and debugging.
 */

const MAX_TOOL_ROUNDS = 6;
const MAX_LOGGED_RESULT = 2000;
const SESSION_TTL_MS = 2 * 60 * 60 * 1000;

/** chatId -> { contents, usedAt }: the Gemini conversation, including tool calls, so context survives between messages. */
const sessions = new Map();

export { startChat };

/** Gemini conversation for a chat: the live one, or rebuilt from the stored text if the server restarted. */
function contentsFor(chat) {
  for (const [id, s] of sessions) if (Date.now() - s.usedAt > SESSION_TTL_MS) sessions.delete(id);
  let session = sessions.get(String(chat._id));
  if (!session) {
    const contents = chat.messages
      .filter((m) => m.role !== 'system')
      .map((m) => ({ role: m.role === 'user' ? 'user' : 'model', parts: [{ text: m.text }] }));
    session = { contents, usedAt: Date.now() };
    sessions.set(String(chat._id), session);
  }
  session.usedAt = Date.now();
  return session.contents;
}

/**
 * Sends the user's message, lets the model use tools until it can answer, stores the exchange and returns the reply.
 * If the model call fails, the error is stored in the conversation too, so nothing is lost.
 * @returns {Promise<{reply: string, tools: object[]}>}
 */
export async function sendMessage(hotel, user, chatId, text) {
  const chat = await getWritableChat(hotel, user, chatId);
  const contents = contentsFor(chat);
  const userMessage = { role: 'user', text, at: new Date() };
  const mark = contents.length;
  const started = Date.now();
  const tools = [];

  try {
    contents.push({ role: 'user', parts: [{ text }] });
    let reply = '';
    for (let round = 0; round <= MAX_TOOL_ROUNDS; round++) {
      const data = await generateContent({
        systemInstruction: { parts: [{ text: buildStaffPrompt(hotel, user) }] },
        contents,
        tools: [{ functionDeclarations: staffFunctionDeclarations }],
        generationConfig: { temperature: 0.3, maxOutputTokens: 1200 },
      });
      const content = data.candidates?.[0]?.content;
      if (!content?.parts?.length) throw new Error('The model returned an empty answer');
      contents.push(content); // keep verbatim (includes Gemini's thought signatures)
      const calls = content.parts.filter((p) => p.functionCall);
      if (!calls.length) {
        reply = content.parts
          .map((p) => p.text || '')
          .join('')
          .trim();
        break;
      }
      const responses = [];
      for (const { functionCall: call } of calls) {
        const t0 = Date.now();
        const result = await runStaffTool({ hotel, user }, call.name, call.args || {});
        tools.push({
          name: call.name,
          args: call.args || {},
          ok: !result.error,
          ms: Date.now() - t0,
          error: result.error,
          result: JSON.stringify(result).slice(0, MAX_LOGGED_RESULT),
        });
        responses.push({ functionResponse: { name: call.name, response: { result } } });
      }
      contents.push({ role: 'user', parts: responses });
    }
    reply ||= 'I got stuck looking that up. Could you rephrase or narrow the question?';
    const assistantMessage = {
      role: 'assistant',
      text: reply,
      at: new Date(),
      tools,
      model: config.gemini.models[0],
      ms: Date.now() - started,
    };
    await recordExchange(chat, [userMessage, assistantMessage]);
    return { reply, tools };
  } catch (e) {
    contents.length = mark; // drop the half-finished turn so the next message starts clean
    await recordExchange(chat, [
      userMessage,
      { role: 'system', text: `Assistant error: ${e.message}`, at: new Date(), tools, ms: Date.now() - started },
    ]);
    throw e;
  }
}

export { getChat };
