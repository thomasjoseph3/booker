import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createKeyPool } from '../../src/agent/shared/keys.js';

test('rotated() starts from the next key each time', () => {
  const pool = createKeyPool(['a', 'b', 'c']);
  assert.deepEqual(pool.rotated(), ['a', 'b', 'c']);
  assert.deepEqual(pool.rotated(), ['b', 'c', 'a']);
  assert.deepEqual(pool.rotated(), ['c', 'a', 'b']);
});

test('a rate limited key moves to the end for that scope only, then comes back', () => {
  let t = 0;
  const pool = createKeyPool(['a', 'b'], () => t);
  pool.markLimited('a', 'model-1', new Error('429 quota exceeded'));
  assert.deepEqual(pool.prefer(['a', 'b'], 'model-1'), ['b', 'a']);
  assert.deepEqual(pool.prefer(['a', 'b'], 'model-2'), ['a', 'b']);
  t = 61_000;
  assert.deepEqual(pool.prefer(['a', 'b'], 'model-1'), ['a', 'b']);
});

test('a daily quota error keeps the key aside much longer', () => {
  let t = 0;
  const pool = createKeyPool(['a', 'b'], () => t);
  pool.markLimited('a', 'm', new Error('Quota exceeded: GenerateRequestsPerDayPerProjectPerModel-FreeTier'));
  t = 10 * 60_000;
  assert.deepEqual(pool.prefer(['a', 'b'], 'm'), ['b', 'a']);
  t = 31 * 60_000;
  assert.deepEqual(pool.prefer(['a', 'b'], 'm'), ['a', 'b']);
});

test('labels never contain the key', () => {
  const pool = createKeyPool(['secret-1', 'secret-2']);
  assert.equal(pool.label('secret-2'), 'key 2/2');
});

test('a single key still works, and when every key is cooling down they are all still offered', () => {
  const one = createKeyPool(['only']);
  assert.deepEqual(one.rotated(), ['only']);
  const pool = createKeyPool(['a', 'b']);
  pool.markLimited('a', 'm', 'quota');
  pool.markBad('b', 'm');
  assert.deepEqual(pool.prefer(['a', 'b'], 'm'), ['a', 'b']);
  assert.equal(createKeyPool([]).rotated().length, 0);
});
