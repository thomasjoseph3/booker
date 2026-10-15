import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { assertOccupancy, assertStayDates, roomsNeededFor } from '../../src/modules/bookings/stayRules.js';
import { ApiError } from '../../src/utils/errors.js';
import { addDays, todayIn } from '../../src/utils/dates.js';
import { hotel, roomType } from '../fixtures/hotel.js';

const today = todayIn(hotel.timezone);
const badRequest = (pattern) => (e) => e instanceof ApiError && e.status === 400 && pattern.test(e.message);

describe('stay dates', () => {
  it('accepts an ordinary future stay', () => {
    assert.doesNotThrow(() => assertStayDates(hotel, addDays(today, 3), addDays(today, 5)));
    assert.doesNotThrow(() => assertStayDates(hotel, today, addDays(today, 1)), 'checking in today is fine');
  });

  it('rejects malformed, inverted and zero-night stays', () => {
    assert.throws(() => assertStayDates(hotel, '2026/12/10', '2026-12-12'), badRequest(/YYYY-MM-DD/));
    assert.throws(() => assertStayDates(hotel, addDays(today, 5), addDays(today, 3)), badRequest(/after check-in/));
    assert.throws(() => assertStayDates(hotel, addDays(today, 5), addDays(today, 5)), badRequest(/after check-in/));
  });

  it('rejects dates in the past, using the property timezone', () => {
    assert.throws(() => assertStayDates(hotel, addDays(today, -1), today), badRequest(/in the past/));
  });

  it('rejects bookings too far ahead or too long', () => {
    assert.throws(() => assertStayDates(hotel, addDays(today, 800), addDays(today, 801)), badRequest(/2 years/));
    assert.throws(() => assertStayDates(hotel, addDays(today, 2), addDays(today, 40)), badRequest(/30 nights/));
    assert.doesNotThrow(() => assertStayDates(hotel, addDays(today, 2), addDays(today, 32)), 'exactly 30 nights is allowed');
  });
});

describe('occupancy', () => {
  // fixture room type: up to 2 adults, 1 child, 3 guests per room
  it('works out how many rooms a party needs', () => {
    assert.equal(roomsNeededFor(roomType, 2, 0), 1);
    assert.equal(roomsNeededFor(roomType, 2, 1), 1);
    assert.equal(roomsNeededFor(roomType, 3, 0), 2);
    assert.equal(roomsNeededFor(roomType, 2, 2), 2, 'one child per room');
    assert.equal(roomsNeededFor(roomType, 4, 2), 2);
    assert.equal(roomsNeededFor({ ...roomType, maxChildren: 0 }, 2, 1), Infinity, 'children not allowed at all');
  });

  it('accepts a party that fits', () => {
    assert.doesNotThrow(() => assertOccupancy(roomType, 2, 1, 1));
    assert.doesNotThrow(() => assertOccupancy(roomType, 4, 0, 2));
  });

  it('explains why a party does not fit, and how many rooms it would need', () => {
    assert.throws(
      () => assertOccupancy(roomType, 3, 0, 1),
      (e) => e.status === 400 && /need at least 2 rooms/.test(e.message) && e.details.roomsNeeded === 2,
    );
    assert.throws(() => assertOccupancy({ ...roomType, maxChildren: 0 }, 2, 1, 1), badRequest(/a different room type/));
  });

  it('requires at least one adult per room', () => {
    assert.throws(() => assertOccupancy(roomType, 1, 0, 2), badRequest(/at least one adult/));
  });
});
