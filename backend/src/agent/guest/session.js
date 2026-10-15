/**
 * State of one call, shared by the text and live agents.
 * `tools` and `bookingCodes` record what the agent did, so the call can be classified when it ends.
 */
export function createSession({ callerPhone = '', callerEmail } = {}) {
  return {
    callerPhone,
    callerEmail,
    startedAt: Date.now(),
    tools: new Set(),
    bookingCodes: new Set(),
  };
}
