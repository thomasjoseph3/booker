import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import { config } from '../../src/config.js';
import { buildSystemPrompt } from '../../src/agent/guest/prompt.js';
import { agentBookingView, hotelProfileForAgent, paymentSentence, roomTypeForAgent } from '../../src/agent/guest/views.js';
import { buildStaffPrompt } from '../../src/agent/staff/prompt.js';
import { bookingBrief, callBrief, paymentBrief, roomBrief } from '../../src/agent/staff/views.js';
import { todayIn } from '../../src/utils/dates.js';
import { booking, hotel } from '../fixtures/hotel.js';

const channels = [...config.guestChannels];
afterEach(() => {
  config.guestChannels = [...channels];
});

describe('guest agent prompt', () => {
  it("names the property, today's date and the booking rules", () => {
    const p = buildSystemPrompt(hotel, { callerPhone: '+919847012345' });
    assert.match(p, /Lakeside Palms Resort/);
    assert.ok(p.includes(todayIn(hotel.timezone)));
    assert.match(p, /Never invent rooms, prices/);
    assert.match(p, /get a clear yes/);
    assert.match(p, /\+919847012345/);
  });

  it('asks for the number when caller ID is missing, and confirms a known email instead of asking', () => {
    assert.match(buildSystemPrompt(hotel, { callerPhone: '' }), /Caller ID is not available/);
    assert.match(buildSystemPrompt(hotel, { callerPhone: '+91', callerEmail: 'a@b.co' }), /email on file.*a@b\.co/);
  });

  it('tells the agent which channels the confirmation goes out on', () => {
    config.guestChannels = ['email'];
    assert.match(buildSystemPrompt(hotel, {}), /sent by email\b/);
    config.guestChannels = ['email', 'whatsapp'];
    assert.match(buildSystemPrompt(hotel, {}), /sent by email and WhatsApp/);
  });

  it('includes property-specific notes when the hotel has them', () => {
    const p = buildSystemPrompt({ ...hotel, agent: { instructions: 'Mention the sunset cruise.' } }, {});
    assert.match(p, /PROPERTY NOTES\nMention the sunset cruise\./);
  });
});

describe('staff assistant prompt', () => {
  it('addresses the staff member, fixes the date and states it is read-only', () => {
    const p = buildStaffPrompt(hotel, { name: 'Anu', role: 'hotel_admin' });
    assert.match(p, /Anu \(hotel admin\)/);
    assert.ok(p.includes(todayIn(hotel.timezone)));
    assert.match(p, /read-only/i);
    assert.match(p, /Never guess numbers/);
  });
});

describe('what the guest agent says', () => {
  it('describes payment and cancellation policy from the hotel settings', () => {
    const profile = hotelProfileForAgent(hotel);
    assert.match(profile.paymentPolicy, /advance of 30%/);
    assert.match(profile.paymentPolicy, /held for 30 minutes/);
    assert.match(profile.cancellationPolicy, /Free cancellation until 48 hours before check-in \(14:00\)/);
    assert.match(profile.cancellationPolicy, /50%/);
    const full = hotelProfileForAgent({ ...hotel, payment: { advanceMode: 'full', holdMinutes: 45, allowPayAtHotel: true } });
    assert.match(full.paymentPolicy, /Full payment/);
    assert.match(full.paymentPolicy, /pay entirely at the hotel/);
  });

  it('tells the caller where the payment link went, and for how long the room is held', () => {
    const payment = { amount: 3000 };
    const held = { ...booking, holdExpiresAt: new Date(Date.now() + 30 * 60000) };
    config.guestChannels = ['email'];
    const email = paymentSentence(hotel, held, payment);
    assert.match(email, /INR 3,000 to your email at asha@example\.com/);
    assert.match(email, /held for you for the next 30 minutes/i);
    config.guestChannels = ['whatsapp'];
    assert.match(paymentSentence(hotel, held, payment), /your WhatsApp at \+919847012345/);
    assert.equal(paymentSentence(hotel, held, null), undefined);
  });

  it('shapes bookings and room types without internal fields', () => {
    const view = agentBookingView({ ...booking, roomType: 'rt1' }, { paymentUrl: 'https://pay/x' });
    assert.equal(view.code, 'BKTEST123');
    assert.equal(view.paymentLink, 'https://pay/x');
    assert.equal(view.amountPaid, 3000);
    assert.equal('history' in view, false);
    assert.deepEqual(roomTypeForAgent({ name: 'A', hotel: 'h', __v: 0, createdAt: 1, updatedAt: 2 }), { name: 'A' });
  });
});

describe('staff assistant data shapes', () => {
  it('summarises a booking compactly, showing hold expiry only while awaiting payment', () => {
    const b = bookingBrief(booking);
    assert.deepEqual([b.code, b.guest, b.room, b.paid, b.balanceDue], ['BKTEST123', 'Asha Menon', '1 × Garden Cottage', 3000, 7000]);
    assert.equal(b.holdExpiresAt, undefined);
    const pending = bookingBrief({ ...booking, status: 'pending_payment', holdExpiresAt: '2026-10-15T07:00:00Z' });
    assert.equal(pending.holdExpiresAt, '2026-10-15T07:00:00Z');
  });

  it('summarises calls, payments and rooms', () => {
    assert.equal(callBrief({ _id: 'c1', outcome: 'booked', bookings: [{ code: 'BK1' }, {}] }).bookings.join(), 'BK1');
    assert.equal(paymentBrief({ _id: 'p1', amount: 5, booking: { code: 'BK1', guestName: 'A' } }).guest, 'A');
    const room = roomBrief({
      number: '101',
      roomType: { name: 'Villa' },
      status: 'occupied',
      currentStay: { guestName: 'Asha', code: 'BK1', checkOut: '2026-10-18' },
    });
    assert.equal(room.currentGuest, 'Asha (BK1, out 2026-10-18)');
  });
});

describe('hold line while a tool runs', () => {
  it('asks the caller to wait in their own language, with Malayalam and Hindi examples', () => {
    const p = buildSystemPrompt(hotel, {});
    assert.match(p, /never in English when they are speaking Malayalam or Hindi/);
    assert.match(p, /ഒരു നിമിഷം കാത്തിരിക്കൂ/);
    assert.match(p, /कृपया एक पल रुकिए/);
    assert.match(p, /Please hold on a moment while I book this/);
  });
});

describe('language matching', () => {
  it('tells the receptionist to follow the caller between Malayalam, English and a mix', () => {
    const p = buildSystemPrompt(hotel, {});
    assert.match(p, /Malayalam in, Malayalam out/);
    assert.match(p, /switch language during the call.*switch with them/);
    assert.match(p, /Do not ask which language/);
  });

  it('limits the receptionist to Malayalam, Hindi and English and treats odd words as mishearings', () => {
    const p = buildSystemPrompt(hotel, {});
    assert.match(p, /exactly three languages: Malayalam, Hindi and English/);
    assert.match(p, /Never speak Spanish, German, French, Tamil, or any other language/);
    assert.match(p, /almost always a mishearing of Malayalam, Hindi or English/);
    assert.match(p, /Hindi in, Hindi out/);
    assert.match(p, /I can help you in Malayalam, Hindi or English/);
    assert.match(p, /booking codes and email addresses letter by letter/);
  });

  it('tells the staff assistant to answer in the language of the question', () => {
    assert.match(buildStaffPrompt(hotel, { name: 'Anu', role: 'staff' }), /language of the person's LATEST message/);
  });
});
