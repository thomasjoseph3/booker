import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { calculate } from '../../src/utils/calculator.js';

describe('calculator', () => {
  it('does the sums the voice agent used to get wrong', () => {
    assert.equal(calculate('6500 * 4'), 26000);
    assert.equal(calculate('26000 - 10% * 26000'), 23400);
    assert.equal(calculate('23400 * 1.12'), 26208);
    assert.equal(calculate('(26208 + 26208) / 2'), 26208);
    assert.equal(calculate('INR 52,416 + ₹26,208'), 78624);
    assert.equal(calculate('4 x 6,500'), 26000);
    assert.equal(calculate('10 / 3'), 3.33);
  });

  it('follows the usual order of operations and handles negatives', () => {
    assert.equal(calculate('2 + 3 * 4'), 14);
    assert.equal(calculate('-5 + 8'), 3);
    assert.equal(calculate('2 * (3 + 4)'), 14);
  });

  it('refuses anything that is not arithmetic, and division by zero', () => {
    for (const bad of ['process.exit()', '2 ** 3', '1 +', '(1 + 2', 'abc', '5 / 0', '']) assert.throws(() => calculate(bad), bad);
  });
});
