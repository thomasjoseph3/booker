import { config } from '../config.js';
import { ApiError, badRequest } from '../utils/errors.js';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Text generation with Gemini (REST). Free-tier keys have tiny per-minute quotas that are tracked per
 * model, so on a 429 we wait briefly and then fall back to the next model in config.gemini.models.
 * (The real-time audio agent uses a WebSocket instead; see liveAgent.js.)
 */
export async function generateContent(body) {
  if (!config.gemini.apiKey) throw badRequest('GEMINI_API_KEY is not configured on the server');
  let last;
  for (const model of config.gemini.models) {
    for (let attempt = 0; attempt < 2; attempt++) {
      const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
        method: 'POST',
        headers: { 'x-goog-api-key': config.gemini.apiKey, 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) return data;
      last = { status: res.status, message: data?.error?.message || String(res.status) };
      if (res.status !== 429) throw new ApiError(502, 'LLM_ERROR', `Gemini (${model}): ${last.message}`);
      const wait = Number(/retry in ([\d.]+)s/i.exec(last.message)?.[1] ?? 0) * 1000;
      if (attempt === 0 && wait > 0 && wait <= 4000) await sleep(wait + 100);
      else break;
    }
  }
  throw new ApiError(
    429,
    'LLM_RATE_LIMITED',
    'The Gemini API quota is used up for now (free keys allow only a few requests per minute). Wait a minute and try again, or enable billing on the key.',
  );
}
