import { callMcpTool, toLangChainTools } from '../shared/mcpTools.js';

const MAX_LOGGED_RESULT = 2000;

/**
 * LangChain tools for one conversation turn. The tool list comes from the MCP server (`mcpTools`) and every tool runs
 * there, as the signed-in user, for their property. Each call (arguments, outcome, time, truncated result) is pushed
 * onto `trace` for the conversation history.
 */
export function buildStaffTools(client, mcpTools, trace) {
  return toLangChainTools(
    mcpTools,
    async (spec, args) => {
      const started = Date.now();
      const result = await callMcpTool(client, spec.name, args);
      const text = JSON.stringify(result);
      trace.push({
        name: spec.name,
        args,
        ok: !result.error,
        ms: Date.now() - started,
        error: result.error,
        result: text.slice(0, MAX_LOGGED_RESULT),
      });
      return text;
    },
    { validate: true }, // LangChain gives the model these tools, so it needs their real schema
  );
}
