import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { validate, validatePatch } from '../../src/middleware/validate.js';
import { ApiError } from '../../src/utils/errors.js';
import { pageQuery } from '../../src/utils/pagination.js';
import { availabilitySchema, createBookingSchema, phone } from '../../src/validation.js';

const objectId = 'a'.repeat(24);

describe('request schemas', () => {
  it('applies defaults and coerces numbers from query strings', () => {
    const r = availabilitySchema.parse({ checkIn: '2026-12-10', checkOut: '2026-12-12', adults: '2' });
    assert.deepEqual([r.adults, r.children, r.roomsCount], [2, 0, 1]);
  });

  it('rejects bad dates and out-of-range counts', () => {
    assert.equal(availabilitySchema.safeParse({ checkIn: 'tomorrow', checkOut: '2026-12-12' }).success, false);
    assert.equal(availabilitySchema.safeParse({ checkIn: '2026-12-10', checkOut: '2026-12-12', adults: 0 }).success, false);
    assert.equal(availabilitySchema.safeParse({ checkIn: '2026-12-10', checkOut: '2026-12-12', roomsCount: 99 }).success, false);
  });

  it('validates guest phone numbers and optional emails', () => {
    assert.equal(phone.safeParse('+91 98470 12345').success, true);
    assert.equal(phone.safeParse('call me').success, false);
    const base = { checkIn: '2026-12-10', checkOut: '2026-12-12', adults: 2, roomTypeId: objectId };
    assert.equal(createBookingSchema.safeParse({ ...base, guest: { name: 'Asha', phone: '+919847012345' } }).success, true);
    assert.equal(createBookingSchema.safeParse({ ...base, guest: { name: 'Asha', phone: '+919847012345', email: '' } }).success, true);
    assert.equal(
      createBookingSchema.safeParse({ ...base, guest: { name: 'Asha', phone: '+919847012345', email: 'not-an-email' } }).success,
      false,
    );
    assert.equal(
      createBookingSchema.safeParse({ ...base, roomTypeId: 'nope', guest: { name: 'A', phone: '+919847012345' } }).success,
      false,
    );
  });

  it('paginates with sane limits', () => {
    assert.deepEqual(pageQuery.parse({}), { page: 1, limit: 50 });
    assert.equal(pageQuery.safeParse({ limit: 500 }).success, false);
    assert.equal(pageQuery.safeParse({ page: 0 }).success, false);
  });
});

describe('validation middleware', () => {
  const run = (middleware, req) => {
    let nextCalled = false;
    middleware(req, {}, () => {
      nextCalled = true;
    });
    return nextCalled;
  };

  it('replaces the body with the parsed data, or throws a readable 400', () => {
    const req = { body: { checkIn: '2026-12-10', checkOut: '2026-12-12' } };
    assert.equal(run(validate(availabilitySchema), req), true);
    assert.equal(req.body.adults, 1);

    assert.throws(
      () => run(validate(availabilitySchema), { body: { checkIn: 'x' } }),
      (e) =>
        e instanceof ApiError && e.status === 400 && e.code === 'VALIDATION_ERROR' && /checkIn/.test(e.message) && Array.isArray(e.details),
    );
  });

  it('puts parsed query strings on req.q', () => {
    const req = { query: { page: '2' } };
    run(validate(pageQuery, 'query'), req);
    assert.deepEqual(req.q, { page: 2, limit: 50 });
  });

  it('keeps only the fields a PATCH sent, so defaults never overwrite stored values', () => {
    const req = { body: { adults: 3 } };
    run(validatePatch(availabilitySchema), req);
    assert.deepEqual(req.body, { adults: 3 });
  });
});
