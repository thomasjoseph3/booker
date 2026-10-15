import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { histEntry, netPaid } from '../../src/modules/bookings/history.js';
import { cancellationQuote } from '../../src/modules/bookings/service.js';
import { booking, hotel } from '../fixtures/hotel.js';

// Check-in is 2026-12-10 at 14:00 IST (08:30 UTC). The free window is 48 hours.
const checkInAt = Date.parse('2026-12-10T08:30:00Z');
const hoursBefore = (h) => new Date(checkInAt - h * 3600 * 1000);

describe('cancellation policy', () => {
  it('is free (and fully refundable) inside the free window', () => {
    const q = cancellationQuote(hotel, booking, hoursBefore(72));
    assert.equal(q.cancellable, true);
    assert.equal(q.freeCancellation, true);
    assert.equal(q.fee, 0);
    assert.equal(q.refundAmount, 3000);
    assert.equal(q.hoursBeforeCheckIn, 72);
  });

  it('charges the late fee after the free window, never more than what was paid', () => {
    const late = cancellationQuote(hotel, booking, hoursBefore(24));
    assert.equal(late.freeCancellation, false);
    assert.equal(late.fee, 3000, '50% of 10000 is 5000 but only 3000 was paid');
    assert.equal(late.refundAmount, 0);

    const paidMore = cancellationQuote(hotel, { ...booking, amountPaid: 8000 }, hoursBefore(24));
    assert.equal(paidMore.fee, 5000);
    assert.equal(paidMore.refundAmount, 3000);
  });

  it('treats the 48-hour boundary as still free', () => {
    assert.equal(cancellationQuote(hotel, booking, hoursBefore(48)).freeCancellation, true);
    assert.equal(cancellationQuote(hotel, booking, hoursBefore(47.9)).freeCancellation, false);
  });

  it('is always free while the booking is still awaiting its advance', () => {
    const q = cancellationQuote(hotel, { ...booking, status: 'pending_payment', amountPaid: 0 }, hoursBefore(2));
    assert.equal(q.freeCancellation, true);
    assert.equal(q.refundAmount, 0);
  });

  it('refuses to cancel bookings that are already finished or cancelled', () => {
    for (const status of ['cancelled', 'checked_in', 'checked_out', 'expired', 'no_show']) {
      const q = cancellationQuote(hotel, { ...booking, status }, hoursBefore(100));
      assert.equal(q.cancellable, false, status);
      assert.match(q.reason, /Booking is/);
    }
  });

  it('subtracts earlier refunds from what counts as paid', () => {
    const q = cancellationQuote(hotel, { ...booking, amountPaid: 5000, amountRefunded: 2000 }, hoursBefore(72));
    assert.equal(q.amountPaid, 3000);
    assert.equal(q.refundAmount, 3000);
  });

  it('respects a stricter property policy', () => {
    const strict = { ...hotel, cancellation: { freeUntilHours: 0, lateFeePercent: 100 } };
    assert.equal(cancellationQuote(strict, booking, hoursBefore(1)).freeCancellation, true);
    assert.equal(cancellationQuote(strict, booking, hoursBefore(-1)).fee, 3000);
  });
});

describe('booking history helpers', () => {
  it('records who did what, defaulting to the system', () => {
    assert.equal(histEntry('confirmed', { label: 'admin:a@b.c' }, 'ok').by, 'admin:a@b.c');
    assert.equal(histEntry('expired', null).by, 'system');
    assert.ok(histEntry('x', null).at instanceof Date);
  });

  it('computes net money kept', () => {
    assert.equal(netPaid({ amountPaid: 5000, amountRefunded: 1500.5 }), 3499.5);
    assert.equal(netPaid({}), 0);
  });
});
