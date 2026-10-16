/**
 * Finds the money amounts in a sentence the agent says, and where an amount came from. Used to check that every
 * amount the agent says is one a tool gave it (see scripts/agent-eval.js), so nothing is invented or worked out by the model.
 */

const UNITS = { zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19 };
const TENS = { twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90 };
const SCALES = { thousand: 1e3, lakh: 1e5, lakhs: 1e5, million: 1e6, crore: 1e7, crores: 1e7 };

/** "seventy-eight thousand six hundred twenty-four" -> 78624 (null when it is not a number). */
export function wordsToNumber(text) {
  const words = text.toLowerCase().replace(/[-,]/g, ' ').split(/\s+/).filter((w) => w && w !== 'and');
  if (!words.length) return null;
  let total = 0;
  let current = 0;
  for (const w of words) {
    if (w in UNITS) current += UNITS[w];
    else if (w in TENS) current += TENS[w];
    else if (w === 'hundred') current = (current || 1) * 100;
    else if (w in SCALES) {
      total += (current || 1) * SCALES[w];
      current = 0;
    } else return null;
  }
  return total + current;
}

const NUMBER_PHRASE = /(?:(?:zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred|thousand|lakhs?|crores?|million)(?:[\s,-]+(?:and[\s,-]+)?)?)+/gi;

/** Amounts of money in the text: "INR 28,000", "₹5,896.80", "twenty-eight thousand rupees", "... rupees and sixty paise". */
export function findAmounts(text) {
  const found = [];
  const t = String(text);
  for (const m of t.matchAll(/(?:₹|INR|Rs\.?)\s*([\d,]+(?:\.\d+)?)|([\d,]+(?:\.\d+)?)\s*(?:rupees|rupee|INR|₹)/gi)) {
    const n = Number((m[1] ?? m[2]).replace(/,/g, ''));
    if (Number.isFinite(n)) found.push({ text: m[0].trim(), value: n });
  }
  // "six thousand five hundred one point six rupees" (a decimal said aloud)
  for (const m of t.matchAll(new RegExp(`(${NUMBER_PHRASE.source})\\s+point\\s+((?:(?:zero|one|two|three|four|five|six|seven|eight|nine)\\s*)+)\\s*(?:rupees?|rs)\\b`, 'gi'))) {
    const whole = wordsToNumber(m[1].trim());
    const digits = m[2].trim().split(/\s+/).map((w) => wordsToNumber(w));
    if (whole !== null && digits.every((d) => d !== null)) found.push({ text: m[0].trim(), value: Number(`${whole}.${digits.join('')}`) });
  }
  for (const m of t.matchAll(new RegExp(`(?<!point\\s)(${NUMBER_PHRASE.source})\\s*(?:rupees?|rs)\\b(?:\\s+and\\s+(${NUMBER_PHRASE.source})\\s*(?:paise|paisa|paisas))?`, 'gi'))) {
    const rupees = wordsToNumber(m[1].trim());
    if (rupees === null) continue;
    const paise = m[2] ? wordsToNumber(m[2].trim()) : 0;
    found.push({ text: m[0].trim(), value: rupees + (paise ?? 0) / 100 });
  }
  return found;
}

/** Every number in a tool result (JSON text), so an amount can be matched to what the tool said. */
export function numbersIn(text) {
  const out = new Set();
  for (const m of String(text).matchAll(/\d[\d,]*(?:\.\d+)?/g)) {
    const n = Number(m[0].replace(/,/g, ''));
    if (Number.isFinite(n)) out.add(n);
  }
  return out;
}

export const sameAmount = (a, b) => Math.abs(a - b) < 0.011;
