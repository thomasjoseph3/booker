import mongoose from 'mongoose';

const { Schema } = mongoose;

const hotelSchema = new Schema(
  {
    name: { type: String, required: true, trim: true },
    slug: { type: String, required: true, unique: true, lowercase: true, trim: true },
    propertyType: { type: String, enum: ['hotel', 'resort', 'homestay', 'villa', 'hostel', 'other'], default: 'hotel' },
    description: String,
    starRating: { type: Number, min: 0, max: 7 },
    contact: { phone: String, email: String, website: String },
    address: { line1: String, line2: String, city: String, state: String, country: String, postalCode: String, mapsUrl: String },
    timezone: { type: String, default: 'Asia/Kolkata' },
    currency: { type: String, default: 'INR', uppercase: true },
    checkInTime: { type: String, default: '14:00' },
    checkOutTime: { type: String, default: '11:00' },
    // Inbound numbers that route to this property's agent (E.164)
    phoneNumbers: { type: [String], default: [], index: true },
    amenities: { type: [String], default: [] },
    policies: {
      petsAllowed: { type: Boolean, default: false },
      smokingAllowed: { type: Boolean, default: false },
      idRequired: { type: String, default: 'Government-issued photo ID required at check-in for all adult guests.' },
      childPolicy: { type: String, default: 'Children under 6 stay free using existing bedding.' },
      other: { type: [String], default: [] },
    },
    faqs: { type: [{ question: String, answer: String, _id: false }], default: [] },
    taxPercent: { type: Number, default: 12, min: 0 },
    payment: {
      // full: pay everything now; percentage: pay `percentage`% now; first_night: first night now; none: no advance
      advanceMode: { type: String, enum: ['full', 'percentage', 'first_night', 'none'], default: 'percentage' },
      advancePercent: { type: Number, default: 30, min: 0, max: 100 },
      // Unpaid bookings hold inventory for this long, then expire
      holdMinutes: { type: Number, default: 30, min: 5 }, // payment-link window
      allowPayAtHotel: { type: Boolean, default: false },
    },
    cancellation: {
      freeUntilHours: { type: Number, default: 48, min: 0 }, // hours before check-in time
      lateFeePercent: { type: Number, default: 50, min: 0, max: 100 }, // % of total charged after the free window
      noShowFeePercent: { type: Number, default: 100, min: 0, max: 100 },
    },
    agent: {
      apiKeyHash: { type: String, index: true, select: false },
      apiKeyPreview: String,
      greeting: String,
      language: { type: String, default: 'en-IN' },
      instructions: String, // extra property-specific guidance for the voice agent
    },
    active: { type: Boolean, default: true },
  },
  { timestamps: true },
);

export const Hotel = mongoose.model('Hotel', hotelSchema);
