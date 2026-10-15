import { ChatGoogleGenerativeAI } from '@langchain/google-genai';
import { config } from '../../config.js';
import { ApiError, badRequest } from '../../utils/errors.js';
import { keyPool } from './keys.js';

/**
 * The chat models the text agents use, created through LangChain. This is the one place that knows about the
 * provider: to switch to another one (Claude, OpenAI), change `chatModel` and the settings in config.js.
 *
 * Free Gemini keys have small per-minute and per-day quotas that are tracked per model, so there is a primary
 * model plus fallbacks (config.gemini.models, from GEMINI_MODEL and GEMINI_FALLBACK_MODELS). With several API keys the
 * order of attempts is: every key on the primary model, then every key on the next model, and so on. A key that hits
 * its quota is set aside for a while (see keys.js) so later requests skip it.
 */

const chatModel = (name, key, { temperature, maxOutputTokens }) =>
  new ChatGoogleGenerativeAI({
    model: name,
    apiKey: key,
    temperature,
    maxOutputTokens,
    maxRetries: 0,
    callbacks: [
      {
        handleLLMError: (error) => {
          if (isRateLimit(error)) {
            keyPool.markLimited(key, name, error);
            console.warn(`[agent] ${name} rate limited on ${keyPool.label(key)}`);
          } else if (isBadKey(error)) {
            keyPool.markBad(key, name);
            console.warn(`[agent] ${keyPool.label(key)} was rejected by the provider`);
          }
        },
      },
    ],
  });

/**
 * @param {{temperature?: number, maxOutputTokens?: number}} [options]
 * @returns {{primary: object, fallbacks: object[]}} the primary model and the fallbacks to try if it fails
 */
export function createModels({ temperature = 0.3, maxOutputTokens = 1200 } = {}) {
  if (!keyPool.size) throw badRequest('GEMINI_API_KEY is not configured on the server');
  const keys = keyPool.rotated();
  const [primary, ...fallbacks] = config.gemini.models.flatMap((name) =>
    keyPool.prefer(keys, name).map((key) => chatModel(name, key, { temperature, maxOutputTokens })),
  );
  return { primary, fallbacks };
}

/** True when the provider rejects the key itself (invalid, expired, revoked, API not enabled). */
export const isBadKey = (error) =>
  /API key (not valid|expired)|API_KEY_INVALID|PERMISSION_DENIED|\b(401|403)\b/i.test(String(error?.message ?? error));

/** True for the errors a provider returns when a quota is used up. */
export const isRateLimit = (error) => /429|quota|rate.?limit|RESOURCE_EXHAUSTED/i.test(String(error?.message ?? error));

/** Turns a model failure into an error the API can return to the user (a clear message for rate limits). */
export function toApiError(error) {
  if (error instanceof ApiError) return error;
  if (isRateLimit(error)) {
    return new ApiError(
      429,
      'LLM_RATE_LIMITED',
      'The AI model quota is used up for now (free keys allow only a few requests per minute and per day). Try again shortly, or enable billing on the key.',
    );
  }
  return new ApiError(502, 'LLM_ERROR', `The AI model failed: ${String(error?.message ?? error).slice(0, 300)}`);
}
