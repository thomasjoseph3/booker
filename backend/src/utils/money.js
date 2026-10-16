/** Formats an amount for people, e.g. `INR 8,400` (Indian digit grouping). */
export const money = (currency, amount) => {
  const n = Number(amount || 0);
  const paise = Math.round(n * 100) % 100 !== 0; // 6,501.60, never 6,501.6: the agent reads it aloud
  return `${currency} ${n.toLocaleString('en-IN', { minimumFractionDigits: paise ? 2 : 0, maximumFractionDigits: 2 })}`;
};

const ONES = ['', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen'];
const TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];
const under100 = (n) => (n < 20 ? ONES[n] : `${TENS[Math.floor(n / 10)]}${n % 10 ? `-${ONES[n % 10]}` : ''}`);
const under1000 = (n) => [n >= 100 && `${ONES[Math.floor(n / 100)]} hundred`, n % 100 && under100(n % 100)].filter(Boolean).join(' ');

/** 139104 -> "one lakh thirty-nine thousand one hundred four" (Indian grouping: crore, lakh, thousand). */
export function numberInWords(n) {
  let rest = Math.floor(Math.abs(n));
  if (rest === 0) return 'zero';
  const parts = [];
  for (const [size, word] of [[1e7, 'crore'], [1e5, 'lakh'], [1e3, 'thousand']]) {
    if (rest >= size) {
      parts.push(`${size === 1e7 ? numberInWords(Math.floor(rest / size)) : under100(Math.floor(rest / size))} ${word}`);
      rest %= size;
    }
  }
  if (rest) parts.push(under1000(rest));
  return parts.join(' ');
}

/**
 * An amount for the voice agent: the figure plus how to say it, e.g. `INR 2,322 ("two thousand three hundred twenty-two
 * rupees")`. Audio models misread long figures (they dropped "thousand" from 2,322), so they are given the words to say.
 */
export function spokenMoney(currency, amount) {
  if (currency !== 'INR') return money(currency, amount);
  const n = Math.round(Number(amount || 0) * 100);
  const paise = n % 100;
  const words = `${numberInWords(Math.floor(n / 100))} rupees${paise ? ` and ${under100(paise)} paise` : ''}`;
  return `${money(currency, amount)} ("${words}")`;
}
