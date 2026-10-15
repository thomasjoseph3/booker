import { ChatGoogleGenerativeAI } from '@langchain/google-genai';
import { config } from '../../config.js';
import { ApiError, badRequest } from '../../utils/errors.js';

/**
 * The chat models the text agents use, created through LangChain. This is the one place that knows about the
 * provider: to switch to another one (Claude, OpenAI), change `chatModel` and the settings in config.js.
 *
 * Free Gemini keys have small per-minute and per-day quotas that are tracked per model, so there is a primary
 * model plus fallbacks (config.gemini.models, from GEMINI_MODEL and GEMINI_FALLBACK_MODELS).
 */

const chatModel = (name, { temperature, maxOutputTokens }) => {
  if (!config.gemini.apiKey) throw badRequest('GEMINI_API_KEY is not configured on the server');
  return new ChatGoogleGenerativeAI({ model: name, apiKey: config.gemini.apiKey, temperature, maxOutputTokens, maxRetries: 0 });
};

/**
 * @param {{temperature?: number, maxOutputTokens?: number}} [options]
 * @returns {{primary: object, fallbacks: object[]}} the primary model and the fallbacks to try if it fails
 */
export function createModels({ temperature = 0.3, maxOutputTokens = 1200 } = {}) {
  const [primary, ...fallbacks] = config.gemini.models.map((name) => chatModel(name, { temperature, maxOutputTokens }));
  return { primary, fallbacks };
}

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
