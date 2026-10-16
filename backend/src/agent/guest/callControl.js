/**
 * Call control, handled by the live call itself and not by the MCP server: it is not a hotel action, it hangs up the
 * call. The model calls it after it has said goodbye; liveAgent.js then hangs up once that last turn has finished
 * playing. Described like the MCP tools so both go to the model in one list.
 */
export const endCallTool = {
  name: 'end_call',
  description:
    'Hang up the call. Use it only when everything is done, you have asked whether there is anything else, and the caller said no or said goodbye. Say your goodbye first, then call this. Never use it while the caller still has a question or a booking is half done.',
  inputSchema: { type: 'object', properties: {} },
};
