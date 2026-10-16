import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { availabilityForAgent, specialRatesForAgent } from '../../src/agent/guest/views.js';

const option = (name, total, advanceDue, extra = {}) => ({
  name,
  bookable: true,
  quote: { currency: 'INR', nights: 4, taxPercent: 12, averageNightlyRate: 7000, total, advanceDue, nightlyRates: [{ price: 7000 }] },
  ...extra,
});

describe('availability for the agent', () => {
  const result = availabilityForAgent({
    checkIn: '2026-10-16',
    checkOut: '2026-10-20',
    options: [
      option('Garden Cottage', 31360, 9408),
      option('Lake View Villa', 52640, 15792),
      { name: 'Pool Villa', bookable: false, reason: 'sold out', quote: { total: 105280 } },
    ],
  });

  it('puts each room’s own total and advance in its own summary', () => {
    const [garden, villa] = result.options;
    assert.match(garden.summary, /^Garden Cottage: INR 31,360 .*advance to confirm INR 9,408/);
    assert.match(villa.summary, /^Lake View Villa: INR 52,640 .*advance to confirm INR 15,792/);
    assert.ok(!villa.summary.includes('31,360'));
  });

  it('keeps the original fields and says what is not available', () => {
    assert.equal(result.options[0].quote.total, 31360);
    assert.equal(result.checkIn, '2026-10-16');
    assert.match(result.options[2].summary, /Pool Villa: not available .*sold out/);
    assert.match(result.note, /never reuse one room's amount/i);
  });
});

describe('special rates for the agent', () => {
  const types = [
    {
      _id: 'lv',
      name: 'Lake View Villa',
      basePrice: 11000,
      weekendPrice: 12500,
      rateOverrides: [
        { from: '2026-12-20', to: '2027-01-02', price: 16000, label: 'Christmas & New Year peak' },
        { from: '2026-11-01', to: '2026-11-30', price: 9000, label: 'Monsoon offer' },
        { from: '2026-01-01', to: '2026-01-10', price: 5000, label: 'Past sale' },
      ],
    },
    { _id: 'gc', name: 'Garden Cottage', basePrice: 6500, weekendPrice: 7500 },
  ];
  const r = specialRatesForAgent(types, '2026-10-15', 'INR');

  it('lists upcoming rates in date order and drops past ones', () => {
    assert.deepEqual(
      r.specialRates.map((x) => x.name),
      ['Monsoon offer', 'Christmas & New Year peak'],
    );
  });

  it('calls a cheaper rate an offer and a dearer one higher, never an offer', () => {
    assert.equal(r.specialRates[0].kind, 'offer');
    assert.equal(r.specialRates[1].kind, 'higher');
    assert.match(
      r.specialRates[1].summary,
      /Lake View Villa, Christmas & New Year peak, 2026-12-20 to 2027-01-02: INR 16,000 a night before tax \(above/,
    );
  });

  it('starts a running rate today and is empty when no room has special rates', () => {
    const running = specialRatesForAgent(
      [{ ...types[0], rateOverrides: [{ from: '2026-10-01', to: '2026-10-31', price: 9000 }] }],
      '2026-10-15',
      'INR',
    );
    assert.equal(running.specialRates[0].from, '2026-10-15');
    assert.equal(running.specialRates[0].name, 'Special rate');
    assert.deepEqual(specialRatesForAgent([types[1]], '2026-10-15', 'INR').specialRates, []);
  });
});

describe('availability explains special-rate nights', () => {
  it('says how many nights are at a named special rate', () => {
    const q = {
      currency: 'INR',
      nights: 3,
      taxPercent: 12,
      averageNightlyRate: 14000,
      total: 47000,
      advanceDue: 14000,
      nightlyRates: [{ price: 16000, label: 'Christmas peak' }, { price: 16000, label: 'Christmas peak' }, { price: 11000 }],
    };
    const { options } = availabilityForAgent({ options: [{ name: 'Lake View Villa', bookable: true, quote: q }] });
    assert.match(options[0].summary, /2 of the nights are at the "Christmas peak" rate\./);
  });
});
