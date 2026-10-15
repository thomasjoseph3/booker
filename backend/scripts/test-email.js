import 'dotenv/config';
import { sendEmail } from '../src/modules/notifications/channels/email.js';
import { renderMessage } from '../src/modules/notifications/service.js';
import { config } from '../src/config.js';

const to = process.argv[2] || config.email.overrideTo || config.email.user;
if (!to) throw new Error('Usage: node scripts/test-email.js you@example.com');
const hotel = {
  name: 'Demo Resort',
  currency: 'INR',
  timezone: 'Asia/Kolkata',
  checkInTime: '14:00',
  checkOutTime: '11:00',
  address: { city: 'Munnar', state: 'Kerala' },
  contact: {},
  policies: {},
  cancellation: {},
};
const booking = {
  code: 'TEST123',
  guestName: 'Test Guest',
  roomsCount: 1,
  roomTypeName: 'Deluxe Villa',
  checkIn: '2026-10-20',
  checkOut: '2026-10-21',
  nights: 1,
  adults: 2,
  children: 0,
  total: 8000,
  amountPaid: 0,
};
const text = renderMessage('payment_link', hotel, booking, {
  amount: 2000,
  url: `${config.publicBaseUrl}/pay/test`,
  expiresAt: new Date(Date.now() + 30 * 60000),
});
console.log(await sendEmail(to, { text, template: 'payment_link', hotel, booking }));
