import { config } from '../../config.js';

/**
 * Rotates several API keys. Free-tier quotas are per key (really per Google project) and per model, so when a key
 * is rate limited it is set aside for a while and the next key is used. The scope is the model name for text calls
 * and 'live' for voice calls.
 * @param {string[]} keys
 * @param {() => number} [now] Clock, replaceable in tests
 */
export function createKeyPool(keys, now = Date.now) {
  const until = new Map(); // `${scope}|${key}` -> time the key can be used again
  let cursor = 0;
  const ready = (key, scope) => (until.get(`${scope}|${key}`) ?? 0) <= now();

  return {
    size: keys.length,
    /** The keys starting from the next one in turn, so calls spread over all keys even before any limit is hit. */
    rotated() {
      const start = keys.length ? cursor++ % keys.length : 0;
      return keys.map((_, i) => keys[(start + i) % keys.length]);
    },
    /** `keys` with the ones that are cooling down for `scope` moved to the end (they are still tried as a last resort). */
    prefer(list, scope = '') {
      return [...list.filter((k) => ready(k, scope)), ...list.filter((k) => !ready(k, scope))];
    },
    /** Sets a key aside after a rate limit: 30 minutes if the daily quota is used up, otherwise a minute. */
    markLimited(key, scope = '', error) {
      const daily = /per.?day|daily/i.test(String(error?.message ?? error ?? ''));
      until.set(`${scope}|${key}`, now() + (daily ? 30 * 60_000 : 60_000));
    },
    /** Sets aside a key the provider rejects (invalid, expired, revoked) for an hour. */
    markBad(key, scope = '') {
      until.set(`${scope}|${key}`, now() + 60 * 60_000);
    },
    /** For logs: "2/3" style position of a key, never the key itself. */
    label: (key) => `key ${keys.indexOf(key) + 1}/${keys.length}`,
  };
}

export const keyPool = createKeyPool(config.gemini.apiKeys);
