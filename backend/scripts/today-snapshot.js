// "Today" at the property: 10 rooms occupied by in-house guests, 5 rooms being cleaned after guests
// checked out this morning, the rest clean and free. Bookings, payments and WhatsApp messages are
// consistent with that state, and inventory counters are derived from the bookings.
import { Booking, Guest, Inventory, Notification, Payment, Room, RoomType } from '../src/models/index.js';
import { renderMessage } from '../src/services/notify.js';
import { quoteStay } from '../src/services/pricing.js';
import { addDays, todayIn, zonedToUtc } from '../src/utils/dates.js';
import { bookingCode, round2 } from '../src/utils/misc.js';
import { heldNights } from './ledger.js';
import { config } from '../src/config.js';

const GUESTS = {
  anjali: { name: 'Anjali Menon', phone: '+919847012345', email: 'anjali.menon@example.com' },
  rahul: { name: 'Rahul Nair', phone: '+919745023456' },
  priya: { name: 'Priya Sharma', phone: '+919895034567', email: 'priya.sharma@example.com' },
  arjun: { name: 'Arjun Pillai', phone: '+919446045678' },
  emma: { name: 'Emma Wilson', phone: '+447700900123', email: 'emma.wilson@example.co.uk' },
  vikram: { name: 'Vikram Reddy', phone: '+919849056789', email: 'vikram.reddy@example.com' },
  meera: { name: 'Meera Krishnan', phone: '+919567067890' },
  daniel: { name: 'Daniel Schmidt', phone: '+4915112345678', email: 'daniel.schmidt@example.de' },
  rohan: { name: 'Rohan Gupta', phone: '+919811078901', email: 'rohan.gupta@example.com' },
  fatima: { name: 'Fatima Shaikh', phone: '+919820089012' },
  karthik: { name: 'Karthik Raman', phone: '+919884090123', email: 'karthik.raman@example.com' },
  divya: { name: 'Divya Thomas', phone: '+919633001234' },
  sophie: { name: 'Sophie Martin', phone: '+33612345678', email: 'sophie.martin@example.fr' },
  joseph: { name: 'Joseph Mathew', phone: '+919495012345' },
  lakshmi: { name: 'Lakshmi Varma', phone: '+919746023456', email: 'lakshmi.varma@example.com' },
};

// [room, guest, check-in offset from today, nights, adults, children, source, lead days, special request]
const IN_HOUSE = [
  ['101', 'anjali', -1, 3, 2, 0, 'website', 12, 'Anniversary — any decoration possible?'],
  ['102', 'rahul', -2, 3, 2, 1, 'admin', 6],
  ['103', 'priya', -1, 2, 1, 0, 'ota', 4],
  ['104', 'arjun', -3, 5, 2, 0, 'website', 20, 'Ground floor room please'],
  ['105', 'emma', -1, 4, 2, 0, 'ota', 30, 'Airport pickup from Kochi'],
  ['201', 'vikram', -2, 4, 2, 2, 'website', 15, 'Need a baby cot'],
  ['202', 'meera', -1, 2, 2, 0, 'admin', 3],
  ['203', 'daniel', -3, 6, 2, 0, 'ota', 45],
  ['301', 'rohan', -1, 3, 3, 1, 'website', 10, 'Birthday cake on arrival'],
  ['302', 'fatima', -2, 3, 2, 0, 'admin', 8, 'Vegetarian meals only'],
];

// Checked out this morning; rooms are being cleaned. [room, guest, check-in offset, adults, children, source, lead]
const VACATED_TODAY = [
  ['106', 'karthik', -2, 2, 0, 'website', 9],
  ['107', 'divya', -3, 1, 0, 'walk_in', 0],
  ['108', 'sophie', -1, 2, 1, 'ota', 18],
  ['204', 'joseph', -4, 2, 2, 'admin', 7],
  ['303', 'lakshmi', -2, 4, 0, 'website', 25],
];

export async function loadTodaySnapshot(hotel) {
  const tz = hotel.timezone;
  const today = todayIn(tz);
  const now = new Date();
  const at = (day, h, m = 0) => zonedToUtc(day, `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`, tz);
  const minutes = (d, n) => new Date(d.getTime() + n * 60000);
  const notPast = (d) => (d > now ? new Date(now.getTime() - 60000) : d);

  const rooms = new Map((await Room.find({ hotel: hotel._id })).map((r) => [r.number, r]));
  const roomTypes = new Map((await RoomType.find({ hotel: hotel._id })).map((rt) => [String(rt._id), rt]));
  const guestDocs = new Map();
  for (const [key, g] of Object.entries(GUESTS)) guestDocs.set(key, await Guest.create({ hotel: hotel._id, ...g }));

  const bookings = [];
  const payments = [];
  const messages = [];
  let vacatedIndex = 0;

  function build({ roomNumber, guestKey, checkIn, nights, adults, children, source, lead, request, vacated }) {
    const room = rooms.get(roomNumber);
    const rt = roomTypes.get(String(room.roomType));
    const guest = guestDocs.get(guestKey);
    const checkOut = addDays(checkIn, nights);
    const quote = quoteStay(hotel, rt, { checkIn, checkOut, roomsCount: 1 });
    const paymentMode = source === 'walk_in' ? 'pay_at_hotel' : 'online';
    const advance = paymentMode === 'online' ? quote.advanceDue : 0;
    const createdAt = source === 'walk_in' ? at(checkIn, 13, 20) : at(addDays(checkIn, -lead), 11, 15);
    const checkedInAt = at(checkIn, 14 + (bookings.length % 4), (bookings.length * 13) % 60);
    const b = new Booking({
      hotel: hotel._id, code: bookingCode(), guest: guest._id, guestName: guest.name, guestPhone: guest.phone, guestEmail: guest.email,
      roomType: rt._id, roomTypeName: rt.name, roomsCount: 1, checkIn, checkOut, nights, adults, children,
      nightlyRates: quote.nightlyRates, currency: hotel.currency, subtotal: quote.subtotal, tax: quote.tax, total: quote.total,
      advanceDue: advance, amountPaid: 0, amountRefunded: 0, paymentMode, source, specialRequests: request,
      status: vacated ? 'checked_out' : 'checked_in', assignedRooms: [room._id], checkedInAt,
      inventoryHeld: !vacated, history: [{ at: createdAt, action: 'created', by: source === 'admin' ? 'admin:desk' : source, note: advance ? `Awaiting advance of ${advance}` : 'Confirmed without advance' }],
      createdAt,
    });
    const msg = (template, when, extra) => messages.push({ hotel: hotel._id, booking: b._id, channel: 'whatsapp', to: guest.phone, template, status: 'logged', message: renderMessage(template, hotel, b, extra), createdAt: when, updatedAt: when });

    if (advance > 0) {
      const paidAt = minutes(createdAt, 6);
      const link = { _id: undefined, hotel: hotel._id, booking: b._id, kind: 'charge', purpose: 'advance', provider: config.paymentProvider, method: 'online', amount: advance, currency: hotel.currency, status: 'paid', paidAt, expiresAt: minutes(createdAt, hotel.payment.holdMinutes), providerPaymentId: `pay_seed_${b.code}`, createdAt, updatedAt: paidAt };
      payments.push(link);
      msg('payment_link', createdAt, { amount: advance, url: `${config.publicBaseUrl}/pay/return`, expiresAt: link.expiresAt });
      b.amountPaid = advance;
      b.history.push({ at: paidAt, action: 'payment_received', by: `payment:${config.paymentProvider}`, note: `${advance} via ${config.paymentProvider}` }, { at: paidAt, action: 'confirmed', by: `payment:${config.paymentProvider}` });
      msg('confirmed', paidAt);
    } else {
      msg('confirmed', createdAt);
    }
    b.history.push({ at: checkedInAt, action: 'checked_in', by: 'admin:desk', note: `Room ${roomNumber}` });

    if (vacated) {
      const planned = [at(today, 8, 10), at(today, 8, 45), at(today, 9, 30), at(today, 10, 5), at(today, 10, 40)][vacatedIndex];
      const outAt = notPast(planned); // stays in the past when seeding early in the morning
      vacatedIndex += 1;
      const due = round2(b.total - b.amountPaid);
      const method = ['upi', 'card', 'cash', 'upi', 'card'][vacatedIndex - 1];
      payments.push({ hotel: hotel._id, booking: b._id, kind: 'charge', purpose: 'balance', provider: 'offline', method, amount: due, currency: hotel.currency, status: 'paid', paidAt: minutes(outAt, -3), recordedBy: 'admin:desk', createdAt: minutes(outAt, -3), updatedAt: minutes(outAt, -3) });
      b.amountPaid = b.total;
      b.checkedOutAt = outAt;
      b.inventoryReleasedFrom = checkOut;
      b.history.push({ at: minutes(outAt, -3), action: 'payment_received', by: 'admin:desk', note: `${due} by ${method}` }, { at: outAt, action: 'checked_out', by: 'admin:desk' });
    }
    b.updatedAt = b.history[b.history.length - 1].at;
    bookings.push(b);
    return b;
  }

  for (const [roomNumber, guestKey, offset, nights, adults, children, source, lead, request] of IN_HOUSE) {
    build({ roomNumber, guestKey, checkIn: addDays(today, offset), nights, adults, children, source, lead, request, vacated: false });
  }
  for (const [roomNumber, guestKey, offset, adults, children, source, lead] of VACATED_TODAY) {
    build({ roomNumber, guestKey, checkIn: addDays(today, offset), nights: -offset, adults, children, source, lead, vacated: true });
  }

  await Booking.insertMany(bookings);
  await Payment.insertMany(payments.map(({ _id, ...p }) => p));
  await Notification.insertMany(messages);

  // Inventory follows the bookings: every night a booking holds counts against its room type.
  const counts = new Map();
  for (const b of bookings) for (const d of heldNights(b)) counts.set(`${b.roomType}:${d}`, (counts.get(`${b.roomType}:${d}`) || 0) + 1);
  await Inventory.insertMany([...counts].map(([k, booked]) => {
    const [roomType, date] = k.split(':');
    return { hotel: hotel._id, roomType, date, booked };
  }));

  const occupied = IN_HOUSE.map((r) => r[0]);
  const cleaning = VACATED_TODAY.map((r) => r[0]);
  await Room.updateMany({ hotel: hotel._id, number: { $in: occupied } }, { $set: { status: 'occupied' } });
  await Room.updateMany({ hotel: hotel._id, number: { $in: cleaning } }, { $set: { status: 'cleaning' } });
  return { inHouse: occupied.length, cleaning: cleaning.length, free: rooms.size - occupied.length - cleaning.length, total: rooms.size };
}
