// Plain-object stand-ins for Mongoose documents, shared by the unit tests.

export const hotel = {
  _id: 'h1',
  name: 'Lakeside Palms Resort',
  slug: 'lakeside-palms',
  propertyType: 'resort',
  timezone: 'Asia/Kolkata',
  currency: 'INR',
  taxPercent: 12,
  checkInTime: '14:00',
  checkOutTime: '11:00',
  address: { line1: 'Kumarakom North', city: 'Kottayam', state: 'Kerala' },
  contact: { phone: '+914842000111' },
  amenities: ['Infinity pool'],
  policies: { idRequired: 'Photo ID required.' },
  faqs: [],
  payment: { advanceMode: 'percentage', advancePercent: 30, holdMinutes: 30, allowPayAtHotel: false },
  cancellation: { freeUntilHours: 48, lateFeePercent: 50, noShowFeePercent: 100 },
  agent: {},
};

export const roomType = {
  name: 'Garden Cottage',
  basePrice: 1000,
  weekendPrice: 1500,
  rateOverrides: [],
  maxAdults: 2,
  maxChildren: 1,
  maxOccupancy: 3,
};

export const booking = {
  code: 'BKTEST123',
  status: 'confirmed',
  guestName: 'Asha Menon',
  guestPhone: '+919847012345',
  guestEmail: 'asha@example.com',
  roomTypeName: 'Garden Cottage',
  roomsCount: 1,
  checkIn: '2026-12-10',
  checkOut: '2026-12-12',
  nights: 2,
  adults: 2,
  children: 0,
  currency: 'INR',
  total: 10000,
  advanceDue: 3000,
  amountPaid: 3000,
  amountRefunded: 0,
  balanceDue: 7000,
  source: 'phone_agent',
};
