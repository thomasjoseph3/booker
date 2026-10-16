// Resets the database and loads one demo property (30 rooms) with today's situation:
// 10 rooms occupied, 5 being cleaned after this morning's check-outs, 15 free.
//   --no-demo   property, rooms and users only (no bookings) — used by the test suite
import bcrypt from 'bcryptjs';
import mongoose from 'mongoose';
import { config } from '../src/config.js';
import { connectDb } from '../src/db.js';
import { AdminUser, Hotel, Room, RoomType } from '../src/models/index.js';
import { generateApiKey, sha256 } from '../src/utils/misc.js';
import { loadTodaySnapshot } from './today-snapshot.js';

if (config.env === 'production') throw new Error('Refusing to reset a production database');
const withDemo = !process.argv.includes('--no-demo');

await mongoose.connect(config.mongoUri);
await mongoose.connection.dropDatabase();
await mongoose.disconnect();
await connectDb();

const year = new Date().getFullYear();

const property = {
  name: 'Lakeside Palms Resort',
  slug: 'lakeside-palms',
  propertyType: 'resort',
  starRating: 4,
  description: 'Backwater resort on Vembanad Lake with private lawns, an infinity pool, Ayurvedic spa and houseboat cruises.',
  contact: { phone: '+914842000111', email: 'reservations@lakesidepalms.example', website: 'https://lakesidepalms.example' },
  address: {
    line1: 'Kumarakom North',
    city: 'Kottayam',
    state: 'Kerala',
    country: 'India',
    postalCode: '686563',
    mapsUrl: 'https://maps.google.com/?q=Kumarakom+Kerala',
  },
  timezone: 'Asia/Kolkata',
  currency: 'INR',
  checkInTime: '14:00',
  checkOutTime: '11:00',
  phoneNumbers: ['+914842000100'],
  amenities: [
    'Infinity pool',
    'Ayurvedic spa',
    'Multi-cuisine restaurant',
    'Free Wi-Fi',
    'Free parking',
    'Houseboat cruises (paid)',
    'Airport transfer (paid)',
    'Kids play area',
  ],
  policies: {
    petsAllowed: false,
    smokingAllowed: false,
    childPolicy: 'Children under 6 stay free using existing bedding. Extra bed available for INR 1,500 per night.',
    other: ['Breakfast is included in all room rates.', 'Outside food is not permitted in the restaurant.'],
  },
  faqs: [
    {
      question: 'How far is the airport?',
      answer: 'Cochin International Airport is about 2 hours by road. We arrange transfers for INR 3,500 one way.',
    },
    { question: 'Is breakfast included?', answer: 'Yes, a Kerala and continental breakfast buffet is included with every room.' },
    {
      question: 'Can we book a houseboat cruise?',
      answer: 'Yes, 2-hour sunset cruises run daily at 4:30 PM for INR 2,000 per person; the front desk books them.',
    },
    { question: 'Is there parking?', answer: 'Yes, free covered parking for all guests.' },
  ],
  taxPercent: 12,
  payment: { advanceMode: 'percentage', advancePercent: 30, holdMinutes: 30, allowPayAtHotel: false },
  cancellation: { freeUntilHours: 72, lateFeePercent: 50, noShowFeePercent: 100 },
  agent: {
    greeting: 'Namaskaram, thank you for calling Lakeside Palms Resort, Kumarakom. How may I help you today?',
    language: 'en-IN',
    instructions:
      'Mention the complimentary breakfast when relevant. The sunset houseboat cruise is paid (INR 2,000 per person), so never call it free.',
  },
};

const range = (prefix, from, to) => Array.from({ length: to - from + 1 }, (_, i) => `${prefix}${String(from + i).padStart(2, '0')}`);

// 30 rooms: 14 cottages (1st floor), 10 lake villas (2nd), 6 pool villas (3rd)
const roomTypes = [
  {
    name: 'Garden Cottage',
    code: 'GC',
    description: 'Cottage facing the tropical garden with a private sit-out.',
    bedType: 'King',
    sizeSqft: 380,
    view: 'Garden',
    maxAdults: 2,
    maxChildren: 1,
    maxOccupancy: 3,
    amenities: ['AC', 'Smart TV', 'Mini fridge', 'Tea/coffee maker'],
    basePrice: 6500,
    weekendPrice: 7500,
    rooms: range('1', 1, 14),
  },
  {
    name: 'Lake View Villa',
    code: 'LV',
    description: 'Spacious villa with floor-to-ceiling windows overlooking the lake and an outdoor shower.',
    bedType: 'King',
    sizeSqft: 650,
    view: 'Lake',
    maxAdults: 3,
    maxChildren: 2,
    maxOccupancy: 4,
    amenities: ['AC', 'Smart TV', 'Bathtub', 'Private deck', 'Minibar'],
    basePrice: 11000,
    weekendPrice: 12500,
    rateOverrides: [{ from: `${year}-12-20`, to: `${year + 1}-01-02`, price: 16000, label: 'Christmas & New Year peak' }],
    rooms: range('2', 1, 10),
  },
  {
    name: 'Pool Villa',
    code: 'PV',
    description: 'Private villa with its own plunge pool and butler service.',
    bedType: 'King',
    sizeSqft: 1100,
    view: 'Lake & pool',
    maxAdults: 4,
    maxChildren: 2,
    maxOccupancy: 5,
    amenities: ['AC', 'Private plunge pool', 'Butler', 'Minibar', 'Bathtub'],
    basePrice: 22000,
    weekendPrice: 25000,
    rooms: range('3', 1, 6),
  },
];

const apiKey = generateApiKey('hk_lakeside');
const hotel = await Hotel.create({
  ...property,
  agent: { ...property.agent, apiKeyHash: sha256(apiKey), apiKeyPreview: `${apiKey.slice(0, 14)}…${apiKey.slice(-4)}` },
});
for (const { rooms, ...rt } of roomTypes) {
  const roomType = await RoomType.create({ ...rt, hotel: hotel._id, totalRooms: rooms.length });
  await Room.insertMany(rooms.map((number) => ({ hotel: hotel._id, roomType: roomType._id, number, floor: number[0] })));
}
const snapshot = withDemo ? await loadTodaySnapshot(hotel) : null;

const password = 'Admin@123';
const passwordHash = await bcrypt.hash(password, 10);
await AdminUser.create([
  { name: 'Platform Admin', email: 'admin@platform.local', passwordHash, role: 'super_admin' },
  { name: 'Lakeside Manager', email: 'manager@lakesidepalms.local', passwordHash, role: 'hotel_admin', hotels: [hotel._id] },
  { name: 'Lakeside Front Desk', email: 'desk@lakesidepalms.local', passwordHash, role: 'staff', hotels: [hotel._id] },
]);

console.log(`\nSeeded ${hotel.name} (slug: ${hotel.slug}) — ${roomTypes.reduce((s, r) => s + r.rooms.length, 0)} rooms`);
if (snapshot)
  console.log(
    `Today: ${snapshot.inHouse} occupied · ${snapshot.cleaning} being cleaned (checked out this morning) · ${snapshot.free} free`,
  );
console.log(`\nAdmin logins (password ${password}):`);
console.log('  manager@lakesidepalms.local   hotel manager');
console.log('  desk@lakesidepalms.local      front desk');
console.log('  admin@platform.local          platform admin');
console.log(`\nAgent API: x-api-key: ${config.agentMasterKey || '(set AGENT_MASTER_KEY)'}  +  x-hotel-id: ${hotel.slug}`);
console.log(`           or this property's own key (shown once): ${apiKey}\n`);
await mongoose.disconnect();
