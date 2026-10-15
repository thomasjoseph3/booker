import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { bookingCode, escapeRegex, generateApiKey, normalizePhone, round2, samePhone, sha256 } from '../../src/utils/misc.js';
import { money } from '../../src/utils/money.js';

describe('phone numbers', () => {
  it('normalises to E.164, adding the default country code to local numbers', () => {
    assert.equal(normalizePhone('+91 98470 12345'), '+919847012345');
    assert.equal(normalizePhone('9847012345'), '+919847012345');
    assert.equal(normalizePhone('098470 12345'), '+919847012345');
    assert.equal(normalizePhone('0044 7700 900123'), '+447700900123');
    assert.equal(normalizePhone('+1 (415) 555-0100'), '+14155550100');
    assert.equal(normalizePhone(''), '');
  });

  it('matches the same person written differently, using the last 10 digits', () => {
    assert.equal(samePhone('+91 98470 12345', '9847012345'), true);
    assert.equal(samePhone('+919847012345', '+919847012346'), false);
    assert.equal(samePhone(undefined, '9847012345'), false);
  });
});

describe('small helpers', () => {
  it('rounds money to 2 decimals', () => {
    assert.equal(round2(10.005), 10.01);
    assert.equal(round2(1 / 3), 0.33);
    assert.equal(round2(8400), 8400);
  });

  it('generates readable booking codes without confusing characters', () => {
    const seen = new Set();
    for (let i = 0; i < 500; i++) {
      const code = bookingCode();
      assert.match(code, /^BK[A-HJ-NP-Z2-9]{6}$/, 'no 0, O, 1 or I (easy to read out on a call)');
      seen.add(code);
    }
    assert.ok(seen.size > 495, 'codes are effectively unique');
  });

  it('generates prefixed API keys and hashes them deterministically', () => {
    assert.match(generateApiKey('hk_demo'), /^hk_demo_[\w-]{20,}$/);
    assert.notEqual(generateApiKey(), generateApiKey());
    assert.equal(sha256('abc'), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });

  it('escapes user text before using it in a regular expression', () => {
    const rx = new RegExp(escapeRegex('a.b*(c)'));
    assert.equal(rx.test('a.b*(c)'), true);
    assert.equal(rx.test('axb'), false);
  });

  it('formats money with Indian digit grouping', () => {
    assert.equal(money('INR', 1234567), 'INR 12,34,567');
    assert.equal(money('INR', 8400), 'INR 8,400');
    assert.equal(money('INR', undefined), 'INR 0');
  });
});
