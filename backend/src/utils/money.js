/** Formats an amount for people, e.g. `INR 8,400` (Indian digit grouping). */
export const money = (currency, amount) => `${currency} ${Number(amount || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
