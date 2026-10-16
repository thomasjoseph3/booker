import assert from 'node:assert/strict';
import jwt from 'jsonwebtoken';
import { describe, it } from 'node:test';
import { config } from '../../src/config.js';
import { guestToolSpecByName } from '../../src/mcp/tools/guest.js';
import { applyCallContext } from '../../src/mcp/context.js';
import { mintCallToken, verifyCallToken } from '../../src/mcp/callToken.js';

const claims = { hotel: 'h1', callId: 'web-1', phone: '+919847012345', email: 'asha@example.com' };
const spec = (name) => guestToolSpecByName[name];

describe('what the MCP server fills in for a live call', () => {
  it("uses the caller's phone when the model leaves it out, and the number the caller gave when there is one", () => {
    assert.equal(applyCallContext(spec('find_bookings'), {}, claims).phone, '+919847012345');
    assert.equal(applyCallContext(spec('find_bookings'), { phone: '+911111111111' }, claims).phone, '+911111111111');
  });

  it("books with the caller's phone and email and always ties the booking to this call", () => {
    const input = applyCallContext(spec('create_booking'), { guest: { name: 'Asha' }, callId: 'someone-elses-call' }, claims);
    assert.deepEqual(input.guest, { phone: '+919847012345', email: 'asha@example.com', name: 'Asha' });
    assert.equal(input.callId, 'web-1', 'the model cannot name another call');
  });

  it('ties callback requests to this call too, and leaves tools without a phone alone', () => {
    assert.equal(applyCallContext(spec('request_human_callback'), { reason: 'x', callId: 'other' }, claims).callId, 'web-1');
    assert.deepEqual(applyCallContext(spec('check_availability'), { adults: 2 }, claims), { adults: 2 });
  });

  it('does not change the arguments it was given', () => {
    const args = { guest: { name: 'Asha' } };
    applyCallContext(spec('create_booking'), args, claims);
    assert.deepEqual(args, { guest: { name: 'Asha' } });
  });
});

describe('call tokens', () => {
  it('carry the hotel, call and caller, and verify', () => {
    const c = verifyCallToken(mintCallToken({ hotelId: 'h1', callId: 'web-1', phone: '+91', email: 'a@b.co' }, 60));
    assert.deepEqual([c.hotel, c.callId, c.phone, c.email], ['h1', 'web-1', '+91', 'a@b.co']);
  });

  it('are refused when forged, expired, or meant for something else', () => {
    const good = mintCallToken({ hotelId: 'h1', callId: 'web-1' }, 60);
    assert.throws(() => verifyCallToken(good.slice(0, -3) + 'abc'), /signature/);
    assert.throws(() => verifyCallToken(jwt.sign({ hotel: 'h1' }, 'another-secret', { audience: 'mcp-call' })), /signature/);
    assert.throws(() => verifyCallToken(mintCallToken({ hotelId: 'h1', callId: 'web-1' }, -10)), /expired/);
    assert.throws(() => verifyCallToken(jwt.sign({ sub: 'u1' }, config.mcp.secret)), /audience/, 'a login-style token is not a call token');
    assert.throws(
      () => verifyCallToken(jwt.sign({ hotel: 'h1' }, config.jwtSecret, { audience: 'mcp-call' })),
      /signature/,
      'signed with the login secret',
    );
  });
});
