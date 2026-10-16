import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { findAmounts, numbersIn, sameAmount, wordsToNumber } from '../../src/agent/shared/amounts.js';

describe('amounts the agent says', () => {
  it('reads number words', () => {
    assert.equal(wordsToNumber('seventy-eight thousand six hundred twenty-four'), 78624);
    assert.equal(wordsToNumber('one lakh thirty-nine thousand one hundred and four'), 139104);
    assert.equal(wordsToNumber('twenty eight thousand'), 28000);
    assert.equal(wordsToNumber('banana'), null);
  });

  it('finds amounts written with digits or words, and ignores other numbers', () => {
    const a = findAmounts('That is INR 1,39,104 in total, or twenty-eight thousand rupees a night, for 3 nights from the 20th.');
    assert.deepEqual(a.map((x) => x.value), [139104, 28000]);
    assert.equal(findAmounts('twenty thousand eight hundred sixty-five rupees and sixty paise')[0].value, 20865.6);
    assert.deepEqual(findAmounts('two rooms for three nights'), []);
  });

  it('collects the numbers a tool result contains', () => {
    const n = numbersIn('{"total":69552,"summary":"INR 1,39,104; advance INR 20,865.6"}');
    assert.ok([69552, 139104, 20865.6].every((v) => [...n].some((x) => sameAmount(x, v))));
  });
});

describe('amounts with commas between the words', () => {
  it('reads "six, thousand five hundred fifty-two rupees" as one amount', () => {
    assert.equal(findAmounts('it is six, thousand five hundred fifty-two rupees')[0].value, 6552);
    assert.equal(findAmounts('seventy-two thousand, five hundred seventy-six rupees')[0].value, 72576);
  });
});

describe('decimals and paise said aloud', () => {
  it('reads "point six" and "paisa"', () => {
    assert.equal(findAmounts('six thousand five hundred one point six rupees')[0].value, 6501.6);
    assert.equal(findAmounts('six thousand five hundred one rupees and sixty paisa')[0].value, 6501.6);
  });
});

describe('spoken amounts for the voice agent', () => {
  it('gives the words with Indian grouping and paise', async () => {
    const { numberInWords, spokenMoney } = await import('../../src/utils/money.js');
    assert.equal(numberInWords(2322), 'two thousand three hundred twenty-two');
    assert.equal(numberInWords(139104), 'one lakh thirty-nine thousand one hundred four');
    assert.equal(numberInWords(12500000), 'one crore twenty-five lakh');
    assert.equal(spokenMoney('INR', 6501.6), 'INR 6,501.60 ("six thousand five hundred one rupees and sixty paise")');
    // the words the agent is given read back to the same amount
    for (const n of [2322, 72576, 139104, 21772.8]) assert.equal(findAmounts(spokenMoney('INR', n))[0].value, n);
  });
});
