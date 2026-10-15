import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { advanceAmount, nightlyPrice, quoteStay } from '../../src/modules/bookings/pricing.js';
import { hotel, roomType } from '../fixtures/hotel.js';

// 2026-10-15 is a Thursday, so the nights of 15-18 Oct are Thu, Fri, Sat.
describe('pricing', () => {
  it('uses the weekend rate for Friday and Saturday nights', () => {
    assert.equal(nightlyPrice(roomType, '2026-10-15'), 1000);
    assert.equal(nightlyPrice(roomType, '2026-10-16'), 1500);
    assert.equal(nightlyPrice(roomType, '2026-10-17'), 1500);
    assert.equal(nightlyPrice(roomType, '2026-10-18'), 1000);
  });

  it('lets a seasonal override beat weekend and base rates, and later overrides beat earlier ones', () => {
    const rt = {
      ...roomType,
      rateOverrides: [
        { from: '2026-12-20', to: '2026-12-31', price: 2500, label: 'Season' },
        { from: '2026-12-24', to: '2026-12-26', price: 4000, label: 'Christmas' },
      ],
    };
    assert.equal(nightlyPrice(rt, '2026-12-21'), 2500);
    assert.equal(nightlyPrice(rt, '2026-12-25'), 4000);
    assert.equal(nightlyPrice(rt, '2026-12-27'), 2500);
    assert.equal(nightlyPrice(rt, '2027-01-05'), 1000);
  });

  it('prices a stay with tax and a percentage advance', () => {
    const q = quoteStay(hotel, roomType, { checkIn: '2026-10-15', checkOut: '2026-10-18' });
    assert.equal(q.nights, 3);
    assert.equal(q.subtotal, 4000); // 1000 + 1500 + 1500
    assert.equal(q.tax, 480); // 12%
    assert.equal(q.total, 4480);
    assert.equal(q.advanceDue, 1344); // 30%
    assert.equal(q.averageNightlyRate, 1333.33);
    assert.deepEqual(
      q.nightlyRates.map((n) => n.price),
      [1000, 1500, 1500],
    );
  });

  it('multiplies by the number of rooms', () => {
    const q = quoteStay(hotel, roomType, { checkIn: '2026-10-15', checkOut: '2026-10-16', roomsCount: 3 });
    assert.equal(q.subtotal, 3000);
    assert.equal(q.total, 3360);
  });

  it('supports every advance policy', () => {
    const total = 4480;
    const firstNight = 1120;
    const mode = (advanceMode, extra = {}) => ({ ...hotel, payment: { advanceMode, ...extra } });
    assert.equal(advanceAmount(mode('full'), total, firstNight), 4480);
    assert.equal(advanceAmount(mode('first_night'), total, firstNight), 1120);
    assert.equal(advanceAmount(mode('first_night'), 900, firstNight), 900, 'never more than the total');
    assert.equal(advanceAmount(mode('none'), total, firstNight), 0);
    assert.equal(advanceAmount(mode('percentage', { advancePercent: 50 }), total, firstNight), 2240);
    assert.equal(advanceAmount({ ...hotel, payment: {} }, 1000, 0), 300, 'defaults to 30%');
  });

  it('handles properties without tax', () => {
    const q = quoteStay({ ...hotel, taxPercent: 0 }, roomType, { checkIn: '2026-10-15', checkOut: '2026-10-16' });
    assert.equal(q.tax, 0);
    assert.equal(q.total, 1000);
  });
});
