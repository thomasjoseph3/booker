// Stay dates are plain calendar days ("YYYY-MM-DD") in the hotel's local timezone.
// Using strings avoids off-by-one bugs from timezone conversion.

export const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

function toUtcDate(day) {
  return new Date(`${day}T00:00:00Z`);
}

export function isValidDay(day) {
  if (!DAY_RE.test(day)) return false;
  const d = toUtcDate(day);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === day;
}

export function addDays(day, n) {
  const d = toUtcDate(day);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

// Nights of a stay: [checkIn, checkOut)
export function nightsBetween(checkIn, checkOut) {
  const nights = [];
  for (let d = checkIn; d < checkOut; d = addDays(d, 1)) nights.push(d);
  return nights;
}

// Friday and Saturday nights are treated as weekend nights.
export function isWeekendNight(day) {
  const dow = toUtcDate(day).getUTCDay();
  return dow === 5 || dow === 6;
}

export function todayIn(timeZone) {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}

// Converts a local wall-clock time in `timeZone` to a UTC Date.
export function zonedToUtc(day, time, timeZone) {
  const [y, m, d] = day.split('-').map(Number);
  const [hh, mm] = (time || '00:00').split(':').map(Number);
  const guess = Date.UTC(y, m - 1, d, hh, mm);
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    })
      .formatToParts(new Date(guess))
      .map((p) => [p.type, p.value]),
  );
  const asLocal = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute);
  return new Date(guess - (asLocal - guess));
}

/** The next `days` calendar days from today at the property, e.g. "Thu 2026-10-15 (today)". Models are poor at weekday arithmetic, so the agent is given this list. */
export function upcomingDays(timeZone, days = 21) {
  const today = todayIn(timeZone);
  const [y, m, d] = today.split('-').map(Number);
  return Array.from({ length: days }, (_, i) => {
    const day = new Date(Date.UTC(y, m - 1, d + i));
    const label = day.toLocaleDateString('en-GB', { weekday: 'short', timeZone: 'UTC' });
    return `${label} ${day.toISOString().slice(0, 10)}${i === 0 ? ' (today)' : i === 1 ? ' (tomorrow)' : ''}`;
  });
}
