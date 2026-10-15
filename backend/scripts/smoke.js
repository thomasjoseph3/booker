// End-to-end test against a throwaway database: node scripts/smoke.js
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';

process.env.MONGO_URI = (process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/hotel_agent').replace(/\/[^/]*$/, '/hotel_agent_smoke');
process.env.PAYMENT_PROVIDER = 'mock';
process.env.GUEST_CHANNELS = 'whatsapp'; // never send real email from tests
process.env.WHATSAPP_PROVIDER = 'log';
process.env.NODE_ENV = 'test';
process.env.RAZORPAY_WEBHOOK_SECRET = 'whsec_test';
execFileSync(process.execPath, ['scripts/seed.js', '--no-demo'], { env: process.env, stdio: 'ignore' });

const { config } = await import('../src/config.js');
const { connectDb } = await import('../src/db.js');
const { createApp } = await import('../src/app.js');
const { expireHolds } = await import('../src/modules/bookings/service.js');
const { addDays, todayIn } = await import('../src/utils/dates.js');
const mongoose = (await import('mongoose')).default;

await connectDb();
const server = createApp().listen(0);
const base = `http://127.0.0.1:${server.address().port}`;
let passed = 0;

async function api(method, path, { body, headers = {}, expect } = {}) {
  const res = await fetch(base + path, {
    method,
    headers: { 'content-type': 'application/json', ...headers },
    body: body ? JSON.stringify(body) : undefined,
    redirect: 'manual',
  });
  const text = await res.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    data = text;
  }
  if (expect && res.status !== expect) throw new Error(`${method} ${path} -> ${res.status} (expected ${expect}): ${text.slice(0, 400)}`);
  return { status: res.status, data };
}
async function step(name, fn) {
  await fn();
  passed += 1;
  console.log(`  ✓ ${name}`);
}

const today = todayIn('Asia/Kolkata');
const d = (n) => addDays(today, n);
const caller = '+91 98470 12345';
let admin, lakesideId, metroId, agent, booking, rtByCode;

await step('admin login + list hotels', async () => {
  const { data } = await api('POST', '/api/admin/auth/login', {
    body: { email: 'admin@platform.local', password: 'Admin@123' },
    expect: 200,
  });
  admin = { authorization: `Bearer ${data.token}` };
  const hotels = (await api('GET', '/api/admin/hotels', { headers: admin, expect: 200 })).data.items;
  lakesideId = hotels.find((h) => h.slug === 'lakeside-palms')._id;
});

await step('onboard a second property through the API (hotel, room type, manager)', async () => {
  const hotel = (
    await api('POST', '/api/admin/hotels', {
      headers: admin,
      body: {
        name: 'Metro Grand Hotel',
        slug: 'metro-grand',
        propertyType: 'hotel',
        phoneNumbers: ['+918045000201'],
        payment: { advanceMode: 'first_night', advancePercent: 0, holdMinutes: 30, allowPayAtHotel: true },
      },
      expect: 201,
    })
  ).data;
  metroId = hotel._id;
  await api('POST', `/api/admin/hotels/${metroId}/room-types`, {
    headers: admin,
    body: { name: 'Standard Room', code: 'STD', basePrice: 3200, totalRooms: 8, maxAdults: 2, maxChildren: 1, maxOccupancy: 2 },
    expect: 201,
  });
  await api('POST', '/api/admin/users', {
    headers: admin,
    body: { name: 'Metro Manager', email: 'manager@metrogrand.local', password: 'Admin@123', role: 'hotel_admin', hotels: [metroId] },
    expect: 201,
  });
  const r = await api('GET', `/api/agent/resolve?number=${encodeURIComponent('+918045000201')}`, {
    headers: { 'x-api-key': config.agentMasterKey },
    expect: 200,
  });
  assert.equal(r.data.hotelId, metroId);
});

await step('agent: tools list is public; resolve dialed number with master key', async () => {
  const tools = (await api('GET', '/api/agent/tools', { expect: 200 })).data.tools;
  assert.ok(tools.length >= 10);
  const r = await api('GET', `/api/agent/resolve?number=${encodeURIComponent('+914842000100')}`, {
    headers: { 'x-api-key': config.agentMasterKey },
    expect: 200,
  });
  assert.equal(r.data.hotelId, lakesideId);
  agent = { 'x-api-key': config.agentMasterKey, 'x-hotel-id': lakesideId, 'x-call-id': 'call-smoke-1' };
  await api('GET', '/api/agent/hotel', { expect: 401 });
  await api('GET', '/api/agent/hotel', { headers: { 'x-api-key': config.agentMasterKey }, expect: 400 });
});

await step('agent: hotel profile + room types', async () => {
  const h = (await api('GET', '/api/agent/hotel', { headers: agent, expect: 200 })).data;
  assert.equal(h.todayAtProperty, today);
  assert.match(h.cancellationPolicy, /72 hours/);
  const rts = (await api('GET', '/api/agent/room-types', { headers: agent, expect: 200 })).data.roomTypes;
  rtByCode = Object.fromEntries(rts.map((r) => [r.code, r]));
});

await step('agent: availability (2 adults + 1 child) with quote', async () => {
  const { data } = await api('POST', '/api/agent/availability', {
    headers: agent,
    body: { checkIn: d(10), checkOut: d(12), adults: 2, children: 1 },
    expect: 200,
  });
  const gc = data.options.find((o) => o.code === 'GC');
  assert.equal(gc.bookable, true);
  assert.equal(gc.availableRooms, 14);
  assert.equal(gc.quote.nights, 2);
  assert.equal(gc.quote.total, Math.round(gc.quote.subtotal * 1.12 * 100) / 100);
  assert.equal(gc.quote.advanceDue, Math.round(gc.quote.total * 0.3 * 100) / 100);
});

await step('agent: validation errors are readable', async () => {
  const r = await api('POST', '/api/agent/availability', { headers: agent, body: { checkIn: '2020-01-01', checkOut: d(1) }, expect: 400 });
  assert.match(r.data.error.message, /past/);
  const r2 = await api('POST', '/api/agent/availability', { headers: agent, body: { checkIn: 'tomorrow', checkOut: d(1) }, expect: 400 });
  assert.equal(r2.data.error.code, 'VALIDATION_ERROR');
});

await step('agent: create booking -> pending_payment + payment link on WhatsApp', async () => {
  await api('POST', '/api/agent/calls', {
    headers: agent,
    body: {
      callId: 'call-smoke-1',
      fromNumber: caller,
      toNumber: '+914842000100',
      startedAt: new Date().toISOString(),
      transcript: [{ role: 'agent', text: 'Namaskaram...' }],
    },
    expect: 200,
  });
  const { data } = await api('POST', '/api/agent/bookings', {
    headers: agent,
    body: {
      roomTypeId: rtByCode.GC._id,
      checkIn: d(10),
      checkOut: d(12),
      adults: 2,
      children: 1,
      guest: { name: 'Anjali Menon', phone: caller, email: 'anjali@example.com' },
      specialRequests: 'Late arrival ~10pm',
      callId: 'call-smoke-1',
    },
    expect: 201,
  });
  booking = data.booking;
  assert.equal(booking.status, 'pending_payment');
  assert.ok(booking.paymentLink.includes('/pay/mock/'));
  assert.match(data.sayNext, /payment link/);
});

await step('guest pays via mock link -> confirmed (idempotent on repeat)', async () => {
  const path = new URL(booking.paymentLink).pathname;
  const pageRes = await api('GET', path, { expect: 200 });
  assert.match(pageRes.data, /Pay now/);
  await api('POST', path, { expect: 303 });
  await api('POST', path, { expect: 303 }); // second click must not double-count
  const { data } = await api('GET', `/api/agent/bookings?phone=${encodeURIComponent('9847012345')}`, { headers: agent, expect: 200 });
  const b = data.bookings.find((x) => x.code === booking.code);
  assert.equal(b.status, 'confirmed');
  assert.equal(b.amountPaid, booking.advanceDue);
  booking = b;
});

await step('caller verification: right code + wrong phone is rejected', async () => {
  await api('GET', `/api/agent/bookings?phone=9000000000&code=${booking.code}`, { headers: agent, expect: 404 });
  await api('GET', `/api/agent/bookings?phone=9847012345&code=${booking.code.toLowerCase()}`, { headers: agent, expect: 200 });
});

await step('agent: modify (extend 1 night) -> repriced + top-up link for extra advance', async () => {
  const { data } = await api('PATCH', `/api/agent/bookings/${booking.code}`, {
    headers: agent,
    body: { phone: caller, checkOut: d(13) },
    expect: 200,
  });
  assert.equal(data.booking.nights, 3);
  assert.ok(data.booking.total > booking.total);
  assert.ok(data.booking.paymentLink, 'expected a top-up payment link');
  assert.equal(data.booking.status, 'confirmed');
  booking = data.booking;
});

await step('agent: cancellation quote (free) then cancel -> full refund, inventory released', async () => {
  const q = (
    await api('GET', `/api/agent/bookings/${booking.code}/cancellation-quote?phone=${encodeURIComponent(caller)}`, {
      headers: agent,
      expect: 200,
    })
  ).data;
  assert.equal(q.freeCancellation, true);
  assert.equal(q.refundAmount, booking.amountPaid);
  const { data } = await api('POST', `/api/agent/bookings/${booking.code}/cancel`, {
    headers: agent,
    body: { phone: caller, reason: 'Plans changed' },
    expect: 200,
  });
  assert.equal(data.booking.status, 'cancelled');
  assert.equal(data.refundAmount, booking.amountPaid);
  const avail = (
    await api('POST', '/api/agent/availability', { headers: agent, body: { checkIn: d(10), checkOut: d(13), adults: 2 }, expect: 200 })
  ).data;
  assert.equal(avail.options.find((o) => o.code === 'GC').availableRooms, 14);
  await api('POST', `/api/agent/bookings/${booking.code}/cancel`, { headers: agent, body: { phone: caller }, expect: 409 });
});

await step('concurrency: 10 simultaneous bookings for 6 Pool Villas -> exactly 6 succeed', async () => {
  const results = await Promise.all(
    Array.from({ length: 10 }, (_, i) =>
      api('POST', '/api/agent/bookings', {
        headers: agent,
        body: {
          roomTypeId: rtByCode.PV._id,
          checkIn: d(20),
          checkOut: d(23),
          adults: 2,
          guest: { name: `Racer ${i}`, phone: `+9190000000${10 + i}` },
        },
      }),
    ),
  );
  assert.equal(results.filter((r) => r.status === 201).length, 6);
  assert.ok(results.filter((r) => r.status !== 201).every((r) => r.data.error.code === 'NO_AVAILABILITY'));
  const avail = (
    await api('POST', '/api/agent/availability', { headers: agent, body: { checkIn: d(21), checkOut: d(22), adults: 2 }, expect: 200 })
  ).data;
  assert.equal(avail.options.find((o) => o.code === 'PV').availableRooms, 0);
});

let lateBooking;
await step('unpaid hold expires and frees rooms; a late payment re-confirms it', async () => {
  const { data } = await api('POST', '/api/agent/bookings', {
    headers: agent,
    body: {
      roomTypeId: rtByCode.LV._id,
      checkIn: d(30),
      checkOut: d(31),
      adults: 2,
      guest: { name: 'Late Payer', phone: '+919111111111' },
    },
    expect: 201,
  });
  lateBooking = data.booking;
  const n = await expireHolds(new Date(Date.now() + 31 * 60 * 1000));
  assert.ok(n >= 1);
  let avail = (
    await api('POST', '/api/agent/availability', { headers: agent, body: { checkIn: d(30), checkOut: d(31), adults: 2 }, expect: 200 })
  ).data;
  assert.equal(avail.options.find((o) => o.code === 'LV').availableRooms, 10);
  const page = await api('GET', new URL(lateBooking.paymentLink).pathname, { expect: 200 });
  assert.match(page.data, /expired|cancelled/);
  // Simulate the gateway reporting a payment that was in flight when the hold lapsed
  const { handlePaymentSuccess } = await import('../src/modules/bookings/service.js');
  const { Payment } = await import('../src/models/index.js');
  const p = await Payment.findOne({ paymentUrl: lateBooking.paymentLink });
  await handlePaymentSuccess({ paymentId: p._id });
  const b = (await api('GET', `/api/agent/bookings?phone=9111111111&code=${lateBooking.code}`, { headers: agent, expect: 200 })).data
    .bookings[0];
  assert.equal(b.status, 'confirmed');
  avail = (
    await api('POST', '/api/agent/availability', { headers: agent, body: { checkIn: d(30), checkOut: d(31), adults: 2 }, expect: 200 })
  ).data;
  assert.equal(avail.options.find((o) => o.code === 'LV').availableRooms, 9);
});

await step("tenant isolation: another hotel's key cannot see this booking", async () => {
  const metroKey = { 'x-api-key': config.agentMasterKey, 'x-hotel-id': metroId };
  await api('GET', `/api/agent/bookings?phone=9111111111&code=${lateBooking.code}`, { headers: metroKey, expect: 404 });
  const login = await api('POST', '/api/admin/auth/login', {
    body: { email: 'manager@metrogrand.local', password: 'Admin@123' },
    expect: 200,
  });
  await api('GET', `/api/admin/hotels/${lakesideId}/bookings`, { headers: { authorization: `Bearer ${login.data.token}` }, expect: 403 });
});

await step('per-hotel agent key works and is scoped', async () => {
  const { data } = await api('POST', `/api/admin/hotels/${metroId}/agent-key`, { headers: admin, expect: 200 });
  const h = (await api('GET', '/api/agent/hotel', { headers: { 'x-api-key': data.apiKey }, expect: 200 })).data;
  assert.equal(h.name, 'Metro Grand Hotel');
  await api('GET', '/api/agent/resolve?number=1', { headers: { 'x-api-key': data.apiKey }, expect: 403 });
});

await step('pay-at-hotel booking at a property that allows it -> confirmed immediately', async () => {
  const metroKey = { 'x-api-key': config.agentMasterKey, 'x-hotel-id': metroId };
  const rts = (await api('GET', '/api/agent/room-types', { headers: metroKey, expect: 200 })).data.roomTypes;
  const { data } = await api('POST', '/api/agent/bookings', {
    headers: metroKey,
    body: {
      roomTypeId: rts[0]._id,
      checkIn: d(5),
      checkOut: d(6),
      adults: 1,
      guest: { name: 'Rahul', phone: '+919222222222' },
      paymentMode: 'pay_at_hotel',
    },
    expect: 201,
  });
  assert.equal(data.booking.status, 'confirmed');
  await api('POST', '/api/agent/bookings', {
    headers: agent,
    body: {
      roomTypeId: rtByCode.GC._id,
      checkIn: d(5),
      checkOut: d(6),
      adults: 1,
      guest: { name: 'Rahul', phone: '+919222222222' },
      paymentMode: 'pay_at_hotel',
    },
    expect: 400,
  });
});

await step('front desk: walk-in today -> check-in (room auto-assigned) -> settle -> check-out', async () => {
  const { data } = await api('POST', `/api/admin/hotels/${lakesideId}/bookings`, {
    headers: admin,
    body: {
      roomTypeId: rtByCode.GC._id,
      checkIn: today,
      checkOut: d(1),
      adults: 2,
      guest: { name: 'Walk In', phone: '+919333333333' },
      paymentMode: 'pay_at_hotel',
      source: 'walk_in',
    },
    expect: 201,
  });
  const code = data.booking.code;
  const ci = (await api('POST', `/api/admin/hotels/${lakesideId}/bookings/${code}/check-in`, { headers: admin, body: {}, expect: 200 }))
    .data;
  assert.equal(ci.status, 'checked_in');
  assert.equal(ci.assignedRooms.length, 1);
  const co = await api('POST', `/api/admin/hotels/${lakesideId}/bookings/${code}/check-out`, { headers: admin, body: {}, expect: 409 });
  assert.equal(co.data.error.code, 'BALANCE_DUE');
  await api('POST', `/api/admin/hotels/${lakesideId}/bookings/${code}/payments`, {
    headers: admin,
    body: { amount: data.booking.total, method: 'upi' },
    expect: 201,
  });
  const out = (await api('POST', `/api/admin/hotels/${lakesideId}/bookings/${code}/check-out`, { headers: admin, body: {}, expect: 200 }))
    .data;
  assert.equal(out.status, 'checked_out');
  const rooms = (await api('GET', `/api/admin/hotels/${lakesideId}/rooms?status=cleaning`, { headers: admin, expect: 200 })).data.items;
  assert.equal(rooms.length, 1);
});

await step('stop-sell closes a room type for dates', async () => {
  await api('PUT', `/api/admin/hotels/${lakesideId}/inventory/stop-sell`, {
    headers: admin,
    body: { roomTypeId: rtByCode.GC._id, from: d(40), to: d(41), closed: true },
    expect: 200,
  });
  const avail = (
    await api('POST', '/api/agent/availability', { headers: agent, body: { checkIn: d(40), checkOut: d(42), adults: 2 }, expect: 200 })
  ).data;
  assert.equal(avail.options.find((o) => o.code === 'GC').bookable, false);
  const inv = (await api('GET', `/api/admin/hotels/${lakesideId}/inventory?from=${d(40)}&to=${d(42)}`, { headers: admin, expect: 200 }))
    .data;
  assert.deepEqual(
    inv.roomTypes.find((r) => r.name === 'Garden Cottage').days.map((x) => x.closed),
    [true, true, false],
  );
});

await step('roles: staff cannot change hotel settings; manager can (nested merge)', async () => {
  const staff = (
    await api('POST', '/api/admin/auth/login', { body: { email: 'desk@lakesidepalms.local', password: 'Admin@123' }, expect: 200 })
  ).data.token;
  await api('PATCH', `/api/admin/hotels/${lakesideId}`, {
    headers: { authorization: `Bearer ${staff}` },
    body: { taxPercent: 5 },
    expect: 403,
  });
  const mgr = (
    await api('POST', '/api/admin/auth/login', { body: { email: 'manager@lakesidepalms.local', password: 'Admin@123' }, expect: 200 })
  ).data.token;
  const h = (
    await api('PATCH', `/api/admin/hotels/${lakesideId}`, {
      headers: { authorization: `Bearer ${mgr}` },
      body: { payment: { advancePercent: 40 } },
      expect: 200,
    })
  ).data;
  assert.equal(h.payment.advancePercent, 40);
  assert.equal(h.payment.holdMinutes, 30);
});

await step('agent: callback + call log wrap-up; admin sees them', async () => {
  await api('POST', '/api/agent/callbacks', {
    headers: agent,
    body: { name: 'Anjali', phone: caller, reason: 'Wants a group quote for 12 rooms', priority: 'high', callId: 'call-smoke-1' },
    expect: 201,
  });
  await api('POST', '/api/agent/calls', {
    headers: agent,
    body: {
      callId: 'call-smoke-1',
      endedAt: new Date().toISOString(),
      durationSec: 312,
      summary: 'Booked, extended, then cancelled; asked for group quote.',
      outcome: 'callback_requested',
      transcript: [{ role: 'caller', text: 'Thanks, bye' }],
    },
    expect: 200,
  });
  const calls = (await api('GET', `/api/admin/hotels/${lakesideId}/calls`, { headers: admin, expect: 200 })).data.items;
  const call = (await api('GET', `/api/admin/hotels/${lakesideId}/calls/${calls[0]._id}`, { headers: admin, expect: 200 })).data;
  assert.equal(call.transcript.length, 2);
  assert.equal(call.bookings.length, 1);
  const cbs = (await api('GET', `/api/admin/hotels/${lakesideId}/callbacks?status=open`, { headers: admin, expect: 200 })).data.items;
  assert.ok(cbs.some((c) => c.reason.includes('group quote')));
});

await step('admin: dashboard, booking detail with payments/notifications', async () => {
  const dash = (await api('GET', `/api/admin/hotels/${lakesideId}/dashboard`, { headers: admin, expect: 200 })).data;
  assert.equal(dash.totalRooms, 30);
  assert.deepEqual([dash.roomStatus.available, dash.roomStatus.cleaning], [29, 1]); // the walk-in test checked a guest out
  assert.equal(dash.occupancy.length, 14);
  assert.ok(dash.revenue30d.collected > 0);
  const detail = (await api('GET', `/api/admin/hotels/${lakesideId}/bookings/${booking.code}`, { headers: admin, expect: 200 })).data;
  assert.ok(detail.payments.some((p) => p.kind === 'refund'));
  assert.ok(detail.notifications.length >= 3);
  assert.ok(detail.booking.history.length >= 4);
});

await step('agent: hotel can be addressed by slug', async () => {
  const h = (
    await api('GET', '/api/agent/hotel', { headers: { 'x-api-key': config.agentMasterKey, 'x-hotel-id': 'metro-grand' }, expect: 200 })
  ).data;
  assert.equal(h.name, 'Metro Grand Hotel');
  await api('GET', '/api/agent/hotel', { headers: { 'x-api-key': config.agentMasterKey, 'x-hotel-id': 'no-such-hotel' }, expect: 404 });
});

await step('staff assistant tools: read-only lookups, scoped to one property', async () => {
  const hotels = await import('../src/modules/hotels/repository.js');
  const { runStaffTool } = await import('../src/agent/staff/tools.js');
  const lakeside = { hotel: await hotels.findById(lakesideId), user: { name: 'Test', role: 'hotel_admin' } };
  const metro = { hotel: await hotels.findById(metroId), user: { name: 'Test', role: 'hotel_admin' } };

  const overview = await runStaffTool(lakeside, 'get_overview');
  assert.equal(overview.totalRooms, 30);
  assert.ok(Array.isArray(overview.arrivalsToday) && overview.counts);

  const avail = await runStaffTool(lakeside, 'check_availability', { checkIn: d(40), checkOut: d(41), adults: 2 });
  assert.equal(avail.options.length, 3);
  assert.ok(avail.options.every((o) => o.freeRooms >= 0 && o.total > 0));

  assert.ok(
    (await runStaffTool(lakeside, 'check_availability', { checkIn: 'nope', checkOut: 'never' })).error,
    'bad input comes back as an error, not a crash',
  );
  assert.ok((await runStaffTool(lakeside, 'no_such_tool')).error);

  const found = await runStaffTool(lakeside, 'list_bookings', { query: booking.code });
  assert.equal(found.total, 1);
  const detail = await runStaffTool(lakeside, 'get_booking', { code: booking.code });
  assert.equal(detail.booking.code, booking.code);
  assert.ok(detail.payments.length >= 1 && detail.recentHistory.length >= 1);

  assert.ok((await runStaffTool(metro, 'get_booking', { code: booking.code })).error, "another property's booking is invisible");
});

await step('staff assistant conversations: kept for history, private to their owner, visible to managers', async () => {
  const token = async (email) =>
    `Bearer ${(await api('POST', '/api/admin/auth/login', { body: { email, password: 'Admin@123' }, expect: 200 })).data.token}`;
  const manager = { authorization: await token('manager@lakesidepalms.local') };
  const desk = { authorization: await token('desk@lakesidepalms.local') };
  const base = `/api/admin/hotels/${lakesideId}/assistant/chats`;

  const chat = (await api('POST', base, { headers: desk, expect: 201 })).data;
  const own = (await api('GET', base, { headers: desk, expect: 200 })).data.items;
  assert.ok(own.some((c) => c._id === chat._id));
  assert.equal((await api('GET', `${base}/${chat._id}`, { headers: desk, expect: 200 })).data.messageCount, 0);

  const managersOwn = (await api('GET', base, { headers: manager, expect: 200 })).data.items;
  assert.ok(!managersOwn.some((c) => c._id === chat._id), 'my chats lists only mine');
  const all = (await api('GET', `${base}?scope=all`, { headers: manager, expect: 200 })).data.items;
  assert.ok(
    all.some((c) => c._id === chat._id),
    'a manager can review staff conversations',
  );
  await api('GET', `${base}/${chat._id}`, { headers: manager, expect: 200 });

  const deskAll = (await api('GET', `${base}?scope=all`, { headers: desk, expect: 200 })).data.items;
  assert.ok(
    deskAll.every((c) => c.user._id === own[0].user._id),
    'front desk cannot widen the list to everyone',
  );
  const managersChat = (await api('POST', base, { headers: manager, expect: 201 })).data;
  await api('GET', `${base}/${managersChat._id}`, { headers: desk, expect: 403 });
  await api('POST', `${base}/${managersChat._id}/messages`, { headers: desk, body: { text: 'hi' }, expect: 403 });
});

await step('staff assistant: answers via LangChain, stores the exchange with its tool trace, and records failures', async () => {
  const { AIMessage, fakeModel } = await import('langchain');
  const { sendMessage } = await import('../src/agent/staff/assistant.js');
  const conversations = await import('../src/modules/conversations/service.js');
  const hotels = await import('../src/modules/hotels/repository.js');
  const users = await import('../src/modules/auth/repository.js');
  const hotel = await hotels.findById(lakesideId);
  const manager = await users.findByEmailWithPassword('manager@lakesidepalms.local');

  const chat = await conversations.startChat(hotel, manager);
  const model = fakeModel()
    .respondWithTools([{ name: 'get_overview', args: {} }])
    .respond(new AIMessage('There are 30 rooms.'));
  const answer = await sendMessage(hotel, manager, chat._id, 'How many rooms do we have?', { primary: model });
  assert.equal(answer.reply, 'There are 30 rooms.');
  assert.deepEqual([answer.tools[0].name, answer.tools[0].ok], ['get_overview', true]);

  const stored = await conversations.getChat(hotel, manager, chat._id);
  assert.equal(stored.messageCount, 2);
  assert.equal(stored.title, 'How many rooms do we have?');
  assert.deepEqual(
    stored.messages.map((m) => m.role),
    ['user', 'assistant'],
  );
  assert.equal(stored.messages[1].tools.length, 1);
  assert.match(stored.messages[1].tools[0].result, /"totalRooms":30/, 'the real tool ran against the real data');

  const broken = fakeModel().alwaysThrow(new Error('429 You exceeded your current quota'));
  await assert.rejects(sendMessage(hotel, manager, chat._id, 'And now?', { primary: broken }), (e) => e.status === 429);
  const after = await conversations.getChat(hotel, manager, chat._id);
  assert.equal(after.messages.at(-1).role, 'system', 'the failure is part of the history');
  assert.match(after.messages.at(-1).text, /quota is used up/);
});

await step('calls left open by a crash are closed with an explanation', async () => {
  const calls = await import('../src/modules/calls/repository.js');
  const { closeStaleCalls } = await import('../src/modules/calls/service.js');
  const old = new Date(Date.now() - 60 * 60 * 1000);
  await calls.createCall({
    hotel: lakesideId,
    callId: 'stale-call',
    startedAt: old,
    transcript: [{ role: 'caller', text: 'hello', at: old }],
  });
  await calls.createCall({ hotel: lakesideId, callId: 'live-call', startedAt: new Date(), transcript: [] });
  assert.ok((await closeStaleCalls(15)) >= 1);
  const stale = await calls.findCallByCallId(lakesideId, 'stale-call');
  assert.ok(stale.endedAt && stale.outcome === 'abandoned' && stale.transcript.at(-1).text.includes('ended unexpectedly'));
  assert.equal((await calls.findCallByCallId(lakesideId, 'live-call')).endedAt, undefined, 'a call in progress is left alone');
});

await step('login is rate limited after repeated failures', async () => {
  const statuses = [];
  for (let i = 0; i < 11; i += 1)
    statuses.push((await api('POST', '/api/admin/auth/login', { body: { email: 'brute@force.test', password: 'wrong' } })).status);
  assert.equal(
    statuses.slice(0, 10).every((s) => s === 401),
    true,
  );
  assert.equal(statuses[10], 429);
});

await step('webhook: bad gateway signature is rejected', async () => {
  const r = await fetch(`${base}/api/payments/webhook/razorpay`, {
    method: 'POST',
    headers: { 'x-razorpay-signature': 'nope' },
    body: '{}',
  });
  assert.equal(r.status, 400);
});

await step('invariant: inventory counters equal the nights every booking holds', async () => {
  const { Booking, Inventory } = await import('../src/models/index.js');
  const { heldNights } = await import('./ledger.js');
  const expected = new Map();
  for (const b of await Booking.find()) {
    for (const date of heldNights(b)) {
      const k = `${b.roomType}:${date}`;
      expected.set(k, (expected.get(k) || 0) + b.roomsCount);
    }
  }
  for (const row of await Inventory.find()) {
    assert.equal(row.booked, expected.get(`${row.roomType}:${row.date}`) || 0, `inventory drift on ${row.date}`);
  }
});

console.log(`\n${passed} checks passed`);
server.close();
await mongoose.connection.dropDatabase();
await mongoose.disconnect();
