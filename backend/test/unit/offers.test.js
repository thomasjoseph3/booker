import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { quoteStay } from '../../src/modules/bookings/pricing.js';
import { describeConditions } from '../../src/modules/offers/rules.js';
import { availabilityForAgent } from '../../src/agent/guest/views.js';
import { hotel, roomType } from '../fixtures/hotel.js';

// 15-18 Oct 2026: Thu, Fri, Sat nights = 1000 + 1500 + 1500 = 4000 before tax (see pricing.test.js).
const stay = { checkIn: '2026-10-15', checkOut: '2026-10-18' };
const offer = (o) => ({ _id: 'o1', name: 'Stay 3 save 10', percentOff: 10, active: true, roomTypes: [], ...o });

describe('offers', () => {
  it('takes the percentage off the room charge before tax, and the advance follows the lower total', () => {
    const q = quoteStay(hotel, roomType, stay, { offers: [offer({ minNights: 3 })], bookedOn: '2026-10-01' });
    assert.equal(q.subtotalBeforeDiscount, 4000);
    assert.equal(q.discount.amount, 400);
    assert.equal(q.subtotal, 3600);
    const plain = quoteStay(hotel, roomType, stay);
    assert.ok(q.total < plain.total && q.advanceDue < plain.advanceDue);
    assert.equal(plain.discount, null);
  });

  it('gives only the biggest offer that applies (no stacking)', () => {
    const q = quoteStay(hotel, roomType, stay, {
      offers: [offer({ _id: 'a', name: 'Small', percentOff: 5 }), offer({ _id: 'b', name: 'Big', percentOff: 15 })],
      bookedOn: '2026-10-01',
    });
    assert.equal(q.discount.name, 'Big');
    assert.equal(q.discount.amount, 600);
  });

  it('does not apply when a condition is not met, and says what would make it apply', () => {
    const o = offer({ minNights: 4, bookAheadDays: 30 });
    const q = quoteStay(hotel, roomType, stay, { offers: [o], bookedOn: '2026-10-10' });
    assert.equal(q.discount, null);
    assert.equal(q.otherOffers[0].needs, 'stay at least 4 nights and book at least 30 days before check-in');
  });

  it('ignores offers for other room types, other stay dates, expired deadlines and inactive offers', () => {
    const off = (o) => quoteStay(hotel, roomType, stay, { offers: [offer(o)], bookedOn: '2026-10-10' });
    assert.equal(off({ roomTypes: ['someone-else'] }).discount, null);
    assert.equal(off({ stayFrom: '2026-11-01', stayTo: '2026-11-30' }).discount, null);
    assert.equal(off({ stayFrom: '2026-10-15', stayTo: '2026-10-17' }).discount.percent, 10); // last night is the 17th
    assert.equal(off({ stayTo: '2026-10-16' }).discount, null);
    assert.equal(off({ bookUntil: '2026-10-09' }).discount, null);
    assert.equal(off({ active: false }).discount, null);
    assert.equal(off({ roomTypes: [roomType._id] }).discount.percent, 10);
  });

  it('describes conditions in plain words and tells the agent what is included', () => {
    assert.equal(describeConditions(offer({ minNights: 3, bookAheadDays: 14, bookUntil: '2026-11-30' }), ['Garden Cottage']),
      'stay at least 3 nights; book at least 14 days before check-in; book by 2026-11-30; only for Garden Cottage');
    const q = quoteStay(hotel, roomType, stay, { offers: [offer({ minNights: 3 })], bookedOn: '2026-10-01' });
    const { options } = availabilityForAgent({ options: [{ name: 'Garden Cottage', bookable: true, quote: q }] });
    assert.match(options[0].summary, /"Stay 3 save 10" offer is already included: 10% off/);
    assert.match(options[0].summary, /after the offer/);
  });
});

describe('price_stay', () => {
  it('spells out the steps behind a price so the model reads them instead of doing sums', async () => {
    const { calculationFor, priceStayForAgent } = await import('../../src/agent/guest/views.js');
    const q = quoteStay(hotel, roomType, { checkIn: '2026-10-15', checkOut: '2026-10-18', roomsCount: 2 }, { offers: [offer({ minNights: 3 })], bookedOn: '2026-10-01' });
    const steps = calculationFor(q);
    // Amounts carry the words to say, e.g. INR 8,000 ("eight thousand rupees"); compare on the figures only.
    const plain = steps.map((s) => s.replace(/ \("[^"]*"\)/g, ''));
    assert.match(plain[0], /1 night at INR 1,000 and 2 nights at INR 1,500 x 2 rooms = INR 8,000/);
    assert.match(plain[1], /10% off = minus INR 800, so INR 7,200/);
    assert.ok(plain.some((s) => /Total = INR 7,200 \+ INR 864 = INR 8,064/.test(s)));
    assert.ok(plain.some((s) => /Night by night.*add up to the total.*Thursday 15 October INR 2,016/.test(s)));
    assert.match(steps[0], /INR 8,000 \("eight thousand rupees"\)/);
    const result = { checkIn: '2026-10-15', checkOut: '2026-10-18', nights: 3, options: [{ roomTypeId: 'x1', code: 'GC', name: 'Garden Cottage', bookable: true, roomsNeeded: 2, quote: q }] };
    assert.equal(priceStayForAgent(result, 'garden cottage').calculation.length, 7);
    assert.match(priceStayForAgent(result, 'nope').error, /No room type matches/);
  });
});

describe('price_stay for a mix of rooms', () => {
  it('adds the grand total and advance on the server', async () => {
    const { combineQuotes } = await import('../../src/agent/guest/views.js');
    const stay = { checkIn: '2026-10-15', checkOut: '2026-10-18' };
    const q1 = quoteStay(hotel, roomType, stay);
    const q2 = quoteStay(hotel, roomType, { ...stay, roomsCount: 2 });
    const line = (name, q, n) => ({ name, bookable: true, roomsCount: n, checkIn: stay.checkIn, checkOut: stay.checkOut, nights: 3, quote: q });
    const r = combineQuotes([line('A', q1, 1), line('B', q2, 2)]);
    assert.equal(r.grandTotal, q1.total + q2.total);
    assert.equal(r.grandAdvance, Math.round((q1.advanceDue + q2.advanceDue) * 100) / 100);
    assert.match(r.summary, /1 x A: INR 4,480 \+ 2 x B: INR 8,960 = INR 13,440/);
    assert.equal(combineQuotes([{ error: 'No room type matches "x"' }]).error, 'No room type matches "x"');
  });
});

describe('night by night', () => {
  it('splits a discounted stay into nights that add up to the total exactly', () => {
    const q = quoteStay(hotel, roomType, { checkIn: '2026-10-15', checkOut: '2026-10-18' }, { offers: [offer({ minNights: 3 })], bookedOn: '2026-10-01' });
    assert.equal(q.perNight.length, 3);
    assert.equal(Math.round(q.perNight.reduce((s, n) => s + n.total, 0) * 100) / 100, q.total);
    assert.equal(q.perNight[0].total, 1008); // 1000 less 10% = 900, plus 12% tax
  });
});

describe('price_stay when the party needs more rooms than asked', () => {
  it('warns, so the model says so instead of scaling a price', async () => {
    const { priceStayForAgent } = await import('../../src/agent/guest/views.js');
    const q = quoteStay(hotel, roomType, { checkIn: '2026-10-15', checkOut: '2026-10-18', roomsCount: 3 });
    const result = { checkIn: '2026-10-15', checkOut: '2026-10-18', nights: 3, options: [{ roomTypeId: 'x', code: 'GC', name: 'Garden Cottage', bookable: true, roomsNeeded: 3, quote: q }] };
    assert.match(priceStayForAgent(result, 'Garden Cottage', 2).warning, /asked for 2 rooms but .* fewer than 3 Garden Cottage rooms.*Never scale/);
    assert.equal(priceStayForAgent(result, 'Garden Cottage', 3).warning, undefined);
  });
});
