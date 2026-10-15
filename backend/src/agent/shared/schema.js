import { z } from 'zod';

/**
 * Turns zod schemas (the single source of truth for what each tool accepts) into the plain JSON schema that
 * model APIs expect. Providers reject keys they do not know, so the extras zod adds are removed.
 */

const DROP_KEYS = new Set(['$schema', 'additionalProperties', 'default']);
const SAFE_INT = Number.MAX_SAFE_INTEGER;

function clean(node) {
  if (Array.isArray(node)) return node.map(clean);
  if (node === null || typeof node !== 'object') return node;
  const out = {};
  for (const [key, value] of Object.entries(node)) {
    if (DROP_KEYS.has(key)) continue;
    if ((key === 'minimum' || key === 'maximum') && Math.abs(value) >= SAFE_INT) continue; // z.int() adds these bounds
    out[key] = clean(value);
  }
  return out;
}

/** JSON schema for a zod object schema, without the provider-hostile extras. */
export const toJsonSchema = (schema) => clean(z.toJSONSchema(schema, { io: 'input' }));

const hasProperties = (schema) => Object.keys(schema.properties ?? {}).length > 0;

/**
 * Gemini `functionDeclarations` for LangChain tools. Gemini rejects an empty `parameters` object, so tools
 * without arguments omit it.
 */
export const geminiDeclarations = (tools) =>
  tools.map((t) => {
    const parameters = toJsonSchema(t.schema);
    return { name: t.name, description: t.description, ...(hasProperties(parameters) ? { parameters } : {}) };
  });
