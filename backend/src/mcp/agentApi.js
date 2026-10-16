import { config } from '../config.js';

/**
 * Calls one /api/agent endpoint for a tool spec: `{id}` in the path comes from the input, GET inputs go in the query
 * string, the rest in a JSON body. Used by the live call and by the MCP server so both go through the same endpoints
 * (validation, tenant scoping and response shaping live there). Never throws: failures come back as `{ error }`.
 */
export async function requestAgentApi(spec, input, headers, fetchImpl = globalThis.fetch, baseUrl = `http://127.0.0.1:${config.port}`) {
  const { method, path } = spec.http;
  const url = new URL(
    path.replace(/\{(\w+)\}/g, (_, k) => encodeURIComponent(input[k] ?? '')),
    baseUrl,
  );
  const asQuery = method === 'GET';
  if (asQuery) for (const [k, v] of Object.entries(input)) if (v !== undefined && v !== '') url.searchParams.set(k, String(v));
  try {
    const res = await fetchImpl(url, {
      method,
      headers: { ...headers, ...(asQuery ? {} : { 'content-type': 'application/json' }) },
      body: asQuery ? undefined : JSON.stringify(input),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return { error: data?.error?.message || `Request failed (${res.status})`, details: data?.error?.details };
    return data;
  } catch (e) {
    return { error: e.message };
  }
}
