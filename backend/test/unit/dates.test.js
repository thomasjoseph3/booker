import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { addDays, isValidDay, isWeekendNight, nightsBetween, todayIn, zonedToUtc } from '../../src/utils/dates.js';

describe('dates', () => {
  it('validates calendar days, including impossible ones', () => {
    assert.equal(isValidDay('2026-10-15'), true);
    assert.equal(isValidDay('2028-02-29'), true); // leap year
    assert.equal(isValidDay('2027-02-29'), false);
    assert.equal(isValidDay('2026-02-30'), false);
    assert.equal(isValidDay('2026-13-01'), false);
    assert.equal(isValidDay('15-10-2026'), false);
    assert.equal(isValidDay(''), false);
  });

  it('adds days across month and year boundaries', () => {
    assert.equal(addDays('2026-10-31', 1), '2026-11-01');
    assert.equal(addDays('2026-12-31', 1), '2027-01-01');
    assert.equal(addDays('2026-03-01', -1), '2026-02-28');
    assert.equal(addDays('2026-10-15', 0), '2026-10-15');
  });

  it('lists the nights of a stay as [checkIn, checkOut)', () => {
    assert.deepEqual(nightsBetween('2026-10-15', '2026-10-18'), ['2026-10-15', '2026-10-16', '2026-10-17']);
    assert.deepEqual(nightsBetween('2026-10-15', '2026-10-15'), []);
  });

  it('treats Friday and Saturday nights as weekend nights', () => {
    assert.equal(isWeekendNight('2026-10-15'), false); // Thursday
    assert.equal(isWeekendNight('2026-10-16'), true); // Friday
    assert.equal(isWeekendNight('2026-10-17'), true); // Saturday
    assert.equal(isWeekendNight('2026-10-18'), false); // Sunday
  });

  it("returns today's date in the property's timezone", () => {
    assert.match(todayIn('Asia/Kolkata'), /^\d{4}-\d{2}-\d{2}$/);
  });

  it('converts hotel wall-clock time to UTC, including daylight saving', () => {
    assert.equal(zonedToUtc('2026-12-10', '14:00', 'Asia/Kolkata').toISOString(), '2026-12-10T08:30:00.000Z');
    assert.equal(zonedToUtc('2026-07-01', '09:00', 'America/New_York').toISOString(), '2026-07-01T13:00:00.000Z'); // EDT
    assert.equal(zonedToUtc('2026-01-01', '09:00', 'America/New_York').toISOString(), '2026-01-01T14:00:00.000Z'); // EST
  });
});

describe('upcomingDays', () => {
  it('lists the next days with their weekday, marking today and tomorrow', async () => {
    const { upcomingDays } = await import('../../src/utils/dates.js');
    const days = upcomingDays('Asia/Kolkata', 10);
    assert.equal(days.length, 10);
    assert.match(days[0], /^[A-Z][a-z]{2} \d{4}-\d{2}-\d{2} \(today\)$/);
    assert.match(days[1], /\(tomorrow\)$/);
    const monday = days.find((d) => d.startsWith('Mon'));
    assert.ok(monday && new Date(monday.slice(4, 14)).getUTCDay() === 1);
  });
});
