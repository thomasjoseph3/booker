/**
 * The AI agents. There are two, with different users, permissions and tools:
 *
 *   guest/    The receptionist guests talk to (public website call, phone). Books and manages the caller's own bookings.
 *   staff/    The assistant for signed-in hotel staff. Answers questions about analytics, availability, rooms, bookings...
 *   shared/   What both use (the Gemini client).
 *
 * Agents change hotel data only through the same services and APIs the dashboard uses, never through the database directly.
 */
export { default as agentRouter } from './guest/routes.js';
export { attachLiveAgent } from './guest/liveAgent.js';
export * as textAgent from './guest/textAgent.js';
export { default as guestTestRoutes } from './guest/testCallRoutes.js';
export { default as staffAssistantRoutes } from './staff/routes.js';
