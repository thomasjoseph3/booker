// Walk-through of a phone booking, using the agent API exactly as the voice agent will.
// The caller's and agent's words are scripted (there is no AI yet); every tool call and every
// answer comes from the real API and changes real data, so the booking shows up in the admin.
//
//   npm run demo:call              guest books tonight's Lake View Villa and pays the advance
//   npm run demo:call -- --unpaid  guest never pays: watch the hold expire on the dashboard after 30 min
//
// Needs the API running (npm run dev).
import { config } from '../src/config.js';

const API = `http://localhost:${config.port}`;
const DIALED = '+914842000100';
const CALLER = { name: 'Nikhil Kurian', phone: '+919900112233', email: 'nikhil.kurian@example.com' };
const unpaid = process.argv.includes('--unpaid');

const c = { dim: (s) => `\x1b[2m${s}\x1b[0m`, cyan: (s) => `\x1b[36m${s}\x1b[0m`, green: (s) => `\x1b[32m${s}\x1b[0m`, yellow: (s) => `\x1b[33m${s}\x1b[0m`, bold: (s) => `\x1b[1m${s}\x1b[0m` };
const transcript = [];
const say = (role, text) => {
  transcript.push({ role, text });
  console.log(`\n${role === 'agent' ? c.cyan('AGENT  ') : c.green('CALLER ')} ${text}`);
};
const money = (n) => `₹${Number(n).toLocaleString('en-IN')}`;
const spell = (code) => code.split('').join(' ');
const time12 = (hhmm) => { const [h, m] = hhmm.split(':').map(Number); return `${((h + 11) % 12) + 1}${m ? `:${String(m).padStart(2, '0')}` : ''} ${h < 12 ? 'AM' : 'PM'}`; };
const plusDays = (day, n) => { const d = new Date(`${day}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };

let hotelHeader = {};
async function tool(name, method, path, body) {
  const res = await fetch(API + path, {
    method,
    headers: { 'x-api-key': config.agentMasterKey, 'content-type': 'application/json', 'x-call-id': callId, ...hotelHeader },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json();
  const shown = body ? JSON.stringify(body) : path.split('?')[1] ?? '';
  console.log(c.dim(`        ⚙ ${name}(${shown.length > 140 ? `${shown.slice(0, 140)}…` : shown}) → HTTP ${res.status}`));
  transcript.push({ role: 'tool', text: `${name}(${shown}) → ${res.status}` });
  if (!res.ok) throw new Error(`${name} failed: ${data?.error?.message}`);
  return data;
}

const callId = `demo-call-${Date.now()}`;

try {
  await fetch(`${API}/health`);
} catch {
  console.error('The API is not running. Start it with `npm run dev` (from the project root) and try again.');
  process.exit(1);
}

console.log(c.bold(`\n☎  Incoming call  ${CALLER.phone} → ${DIALED}`));

// 1. Which property was dialed? (done by the agent runtime before the conversation starts)
const property = await tool('resolve_property', 'GET', `/api/agent/resolve?number=${encodeURIComponent(DIALED)}`);
hotelHeader = { 'x-hotel-id': property.hotelId };
const hotel = await tool('get_hotel_info', 'GET', '/api/agent/hotel');
console.log(c.dim(`        → ${hotel.name}, today at the property is ${hotel.todayAtProperty}`));

say('agent', hotel.agent.greeting);
say('caller', 'Hi! Do you have a room for tonight? It\'s for me and my wife.');

// 2. Availability for tonight
const tonight = hotel.todayAtProperty;
const avail = await tool('check_availability', 'POST', '/api/agent/availability', { checkIn: tonight, checkOut: plusDays(tonight, 1), adults: 2, children: 0 });
for (const o of avail.options) console.log(c.dim(`        → ${o.name}: ${o.availableRooms} free · ${money(o.quote.total)} incl. tax · advance ${money(o.quote.advanceDue)}`));
const bookable = avail.options.filter((o) => o.bookable);
const offers = bookable.map((o) => `the ${o.name} at ${money(o.quote.total)}`);
say('agent', `Yes, we do! For tonight I have ${offers.slice(0, -1).join(', ')}${offers.length > 1 ? ' or ' : ''}${offers.at(-1)}, including taxes and breakfast. ${bookable.find((o) => o.code === 'LV') ? 'The Lake View Villa has floor-to-ceiling windows over the lake — lovely at sunset.' : ''}`);

say('caller', 'The lake view villa sounds perfect. Let\'s book that.');
const villa = bookable.find((o) => o.code === 'LV') ?? bookable[0];
say('agent', `Lovely. May I have your full name for the booking?`);
say('caller', `${CALLER.name}.`);
say('agent', `Thank you, ${CALLER.name.split(' ')[0]}. To confirm: one ${villa.name} for tonight, ${tonight}, checking out tomorrow, for 2 adults. The total is ${money(villa.quote.total)}. To confirm the booking we need an advance of ${money(villa.quote.advanceDue)}, which I'll send to your WhatsApp on this number. Shall I go ahead?`);
say('caller', 'Yes, please.');

// 3. Create the booking: room is held and the payment link goes out on WhatsApp
const created = await tool('create_booking', 'POST', '/api/agent/bookings', {
  roomTypeId: villa.roomTypeId, checkIn: tonight, checkOut: plusDays(tonight, 1), adults: 2, children: 0,
  guest: CALLER, callId,
});
const code = created.booking.code;
say('agent', `Done! Your booking code is ${spell(code)}. ${created.sayNext}`);
say('caller', 'Great, thank you!');
say('agent', `You're welcome, ${CALLER.name.split(' ')[0]}. We look forward to welcoming you tonight — check-in is from ${time12(hotel.checkInTime)}. Have a lovely day!`);

// The script runs in a second; log the talk time a real call this long would take (~2.5 words/sec + pauses).
const words = transcript.filter((t) => t.role !== 'tool').reduce((n, t) => n + t.text.split(/\s+/).length, 0);
const durationSec = Math.round(words / 2.5) + 15;
const endedAt = new Date();
await tool('log_call', 'POST', '/api/agent/calls', {
  callId, fromNumber: CALLER.phone, toNumber: DIALED, startedAt: new Date(endedAt - durationSec * 1000), endedAt, durationSec,
  intent: 'new_booking', outcome: 'booked', sentiment: 'positive', bookingCodes: [code],
  summary: `Booked ${villa.name} for tonight (${code}); advance ${money(villa.quote.advanceDue)} requested on WhatsApp.`,
  transcript: transcript.splice(0),
});
console.log(c.bold('\n☎  Call ended'));

// 4. What the guest receives, and what happens next
console.log(c.yellow(`\n📱 WhatsApp to ${CALLER.phone}: payment link for ${money(created.booking.advanceDue)} — ${created.booking.paymentLink}`));
console.log(c.dim(`   Booking ${code} is "${created.booking.status}"; the room is held until ${new Date(created.booking.holdExpiresAt).toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour: 'numeric', minute: '2-digit' })}.`));

if (unpaid) {
  console.log(c.yellow('\n⏳ The guest does not pay. Open the admin dashboard → "Rooms on hold": when the hold runs out, the backend'));
  console.log(c.yellow('   releases the villa automatically, marks the booking "expired" and messages the guest on WhatsApp.'));
} else {
  // The guest taps the link and pays (the test gateway page; Razorpay in production)
  const payRes = await fetch(created.booking.paymentLink, { method: 'POST', redirect: 'manual' });
  console.log(c.green(`\n💳 Guest pays the advance through the link → HTTP ${payRes.status}`));
  const [after] = (await tool('find_bookings', 'GET', `/api/agent/bookings?phone=${encodeURIComponent(CALLER.phone)}&code=${code}`)).bookings;
  console.log(c.green(`   Booking ${code} is now "${after.status}" · paid ${money(after.amountPaid)} · balance at hotel ${money(after.balanceDue)}`));
  console.log(c.yellow('📱 WhatsApp to guest: booking confirmed + check-in details (address, map link, times, ID rules, balance).'));
}

const again = await tool('check_availability', 'POST', '/api/agent/availability', { checkIn: tonight, checkOut: plusDays(tonight, 1), adults: 2 });
console.log(c.dim(`\nLake View Villas free tonight: ${villa.availableRooms} → ${again.options.find((o) => o.roomTypeId === villa.roomTypeId).availableRooms}`));
console.log(`\nSee it in the admin: Bookings → ${code}, Agent calls → the transcript, WhatsApp log → the messages.\n`);
