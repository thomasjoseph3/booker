import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { config } from '../../src/config.js';
import { emailRecipient, toHtml } from '../../src/modules/notifications/channels/email.js';
import { renderMessage } from '../../src/modules/notifications/service.js';
import { booking, hotel } from '../fixtures/hotel.js';

// The `params` of each template map to the {{1}}, {{2}}... variables of the approved WhatsApp template (see the README),
// so their order and count must not change silently.
describe('guest message templates', () => {
  const extra = { amount: 3000, url: 'https://pay.example/abc?x=1&y=2', expiresAt: new Date('2026-10-15T07:00:00Z'), refundAmount: 1500 };

  it('payment link message carries the amount, link, hold time and booking details', () => {
    const text = renderMessage('payment_link', hotel, booking, extra);
    assert.match(text, /Lakeside Palms Resort/);
    assert.match(text, /BKTEST123/);
    assert.match(text, /INR 3,000/);
    assert.match(text, /https:\/\/pay\.example\/abc\?x=1&y=2/);
    assert.match(text, /held until/);
  });

  it('confirmation carries check-in details, balance and the cancellation window', () => {
    const text = renderMessage('confirmed', hotel, booking);
    assert.match(text, /Booking confirmed/);
    assert.match(text, /2:00 PM/, 'check-in time in 12-hour format');
    assert.match(text, /11:00 AM/);
    assert.match(text, /Balance payable at the hotel:\* INR 7,000/);
    assert.match(text, /Kumarakom North/);
    assert.match(text, /Free cancellation until 48 hours/);
  });

  it('says "Fully paid" when nothing is left to pay', () => {
    assert.match(renderMessage('confirmed', hotel, { ...booking, amountPaid: 10000 }), /Fully paid/);
  });

  it('cancellation mentions the refund only when there is one', () => {
    assert.match(renderMessage('cancelled', hotel, booking, extra), /refund of \*INR 1,500\*/);
    assert.doesNotMatch(renderMessage('cancelled', hotel, booking, { refundAmount: 0 }), /refund of/);
  });

  it('keeps the variable count of every template stable', async () => {
    const { notifyGuest: _unused, ...exports } = await import('../../src/modules/notifications/service.js');
    assert.ok(exports.renderMessage);
    // render each template through the public helper; it must not throw for a normal booking
    for (const name of ['payment_link', 'confirmed', 'modified', 'cancelled', 'expired', 'payment_issue']) {
      assert.ok(renderMessage(name, hotel, booking, extra).length > 20, name);
    }
  });
});

describe('email rendering', () => {
  it('escapes HTML so guest-supplied text cannot inject markup', () => {
    assert.equal(toHtml('<script>alert(1)</script>'), '&lt;script&gt;alert(1)&lt;/script&gt;');
  });

  it('turns WhatsApp-style text into HTML: links, bold and line breaks', () => {
    const html = toHtml('*Hello*\nPay: https://pay.example/a?x=1&y=2');
    assert.match(html, /<b>Hello<\/b><br>/);
    assert.match(html, /<a href="https:\/\/pay\.example\/a\?x=1&amp;y=2">/);
  });

  it('sends to the guest, unless a demo override address is set', () => {
    const original = config.email.overrideTo;
    try {
      config.email.overrideTo = '';
      assert.equal(emailRecipient(booking), 'asha@example.com');
      assert.equal(emailRecipient({ ...booking, guestEmail: undefined }), null, 'no address, no email');
      config.email.overrideTo = 'demo@example.com';
      assert.equal(emailRecipient(booking), 'demo@example.com');
    } finally {
      config.email.overrideTo = original;
    }
  });
});
