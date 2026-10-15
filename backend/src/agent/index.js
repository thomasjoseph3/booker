/**
 * The AI agent module: everything the voice/text receptionist needs, behind one entry point.
 *
 *   routes.js      HTTP API the agent uses as its tools (/api/agent/*)
 *   tools.js       tool definitions (what the agent may do)
 *   prompt.js      persona and rules
 *   textAgent.js   turn-based agent (admin tester)
 *   liveAgent.js   real-time audio agent (website call button) over WebSocket + Gemini Live
 *   toolRunner.js  executes a tool call
 *   callRecord.js  call log: transcript, outcome, summary
 *
 * The agent only changes hotel data through its tools, never through the database directly.
 */
export { default as agentRouter } from './routes.js';
export { attachLiveAgent } from './liveAgent.js';
export * as textAgent from './textAgent.js';
