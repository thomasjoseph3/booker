import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import { cleanSchema } from './schema.js';

/**
 * How the agents use the MCP server's tools. They do not define tools: they ask the server what exists (tools/list),
 * give the model that list, and send every tool call back to the server.
 */

/** The tools the MCP server offers this client: `[{ name, description, inputSchema (JSON schema) }]`. */
export async function listMcpTools(client) {
  const { tools } = await client.listTools();
  return tools;
}

/**
 * Runs one tool on the MCP server and returns the data it gave back. Never throws: failures, including the server's
 * own checks (bad arguments, no access) and an unreachable server, come back as `{ error }` for the model to explain.
 */
export async function callMcpTool(client, name, args) {
  try {
    const res = await client.callTool({ name, arguments: args });
    const text = res.content?.find((c) => c.type === 'text')?.text ?? '';
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      data = { error: text || 'The tool returned nothing' };
    }
    return res.isError && !data.error ? { error: text } : data;
  } catch (e) {
    return { error: e.message };
  }
}

/**
 * LangChain tools for the given MCP tools. `run(mcpTool, args)` does the work and returns the result as text. The
 * server checks the arguments (and accepts what the model sends in loose form, such as "2" for 2), so by default the
 * model's arguments pass through untouched; the model itself is told the real schema by whoever binds the tools.
 * With `{ validate: true }` LangChain also checks the arguments against the server's schema before calling, and the
 * model is told that schema through the tool (needed when LangChain is what binds the tools to the model).
 */
export const toLangChainTools = (mcpTools, run, { validate = false } = {}) =>
  mcpTools.map((t) =>
    tool((args) => run(t, args), {
      name: t.name,
      description: t.description ?? '',
      schema: validate ? cleanSchema(t.inputSchema) : z.looseObject({}),
    }),
  );
