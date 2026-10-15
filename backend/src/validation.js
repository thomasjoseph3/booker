import { z } from 'zod';
import { DAY_RE } from './utils/dates.js';

export const day = z.string().regex(DAY_RE, 'Use YYYY-MM-DD');
export const objectId = z.string().regex(/^[a-f\d]{24}$/i, 'Invalid id');
export const phone = z
  .string()
  .trim()
  .min(7)
  .max(20)
  .regex(/^\+?[\d\s\-()]+$/, 'Invalid phone number');
const optionalEmail = z
  .union([z.email(), z.literal('')])
  .optional()
  .transform((v) => v || undefined);
const count = (min, max) => z.coerce.number().int().min(min).max(max);

export const availabilitySchema = z.object({
  checkIn: day,
  checkOut: day,
  adults: count(1, 50).default(1),
  children: count(0, 50).default(0),
  roomsCount: count(1, 20).default(1),
});

export const guestSchema = z.object({
  name: z.string().trim().min(1).max(120),
  phone,
  email: optionalEmail,
});

export const createBookingSchema = availabilitySchema.extend({
  roomTypeId: objectId,
  guest: guestSchema,
  specialRequests: z.string().max(1000).optional(),
  paymentMode: z.enum(['online', 'pay_at_hotel']).default('online'),
  callId: z.string().max(200).optional(),
});

export const adminCreateBookingSchema = createBookingSchema.extend({
  source: z.enum(['admin', 'walk_in', 'website', 'ota', 'phone_agent']).default('admin'),
});

export const modifyBookingSchema = z.object({
  checkIn: day.optional(),
  checkOut: day.optional(),
  roomTypeId: objectId.optional(),
  adults: count(1, 50).optional(),
  children: count(0, 50).optional(),
  roomsCount: count(1, 20).optional(),
  specialRequests: z.string().max(1000).optional(),
});

export const callerSchema = z.object({ phone });
export const callerLookupSchema = z.object({ phone, code: z.string().trim().max(20).optional() });

export const callbackSchema = z.object({
  name: z.string().max(120).optional(),
  phone,
  reason: z.string().min(3).max(2000),
  priority: z.enum(['low', 'normal', 'high']).default('normal'),
  bookingCode: z.string().max(20).optional(),
  callId: z.string().max(200).optional(),
});

export const callLogSchema = z.object({
  callId: z.string().min(1).max(200),
  direction: z.enum(['inbound', 'outbound']).optional(),
  fromNumber: z.string().max(30).optional(),
  toNumber: z.string().max(30).optional(),
  startedAt: z.coerce.date().optional(),
  endedAt: z.coerce.date().optional(),
  durationSec: z.number().min(0).optional(),
  summary: z.string().max(5000).optional(),
  intent: z.string().max(200).optional(),
  outcome: z.enum(['booked', 'cancelled', 'modified', 'inquiry', 'callback_requested', 'abandoned', 'other']).optional(),
  sentiment: z.enum(['positive', 'neutral', 'negative']).optional(),
  recordingUrl: z.url().optional(),
  bookingCodes: z.array(z.string()).optional(),
  transcript: z
    .array(z.object({ role: z.enum(['caller', 'agent', 'system', 'tool']), text: z.string().max(10000), at: z.coerce.date().optional() }))
    .optional(),
});

// ---- admin config ----

const rateOverride = z.object({ from: day, to: day, price: z.number().min(0), label: z.string().max(100).optional() });

export const roomTypeSchema = z.object({
  name: z.string().trim().min(1).max(120),
  code: z.string().trim().min(1).max(20),
  description: z.string().max(3000).optional(),
  bedType: z.string().max(100).optional(),
  sizeSqft: z.number().min(0).optional(),
  view: z.string().max(100).optional(),
  maxAdults: count(1, 20).default(2),
  maxChildren: count(0, 20).default(1),
  maxOccupancy: count(1, 30).default(3),
  amenities: z.array(z.string().max(100)).default([]),
  images: z.array(z.url()).default([]),
  basePrice: z.number().min(0),
  weekendPrice: z.number().min(0).nullable().optional(),
  rateOverrides: z.array(rateOverride).default([]),
  totalRooms: count(0, 10000),
  active: z.boolean().default(true),
});

export const roomSchema = z.object({
  roomTypeId: objectId,
  number: z.string().trim().min(1).max(20),
  floor: z.string().max(20).optional(),
  status: z.enum(['available', 'occupied', 'cleaning', 'out_of_service']).default('available'),
  notes: z.string().max(1000).optional(),
});

const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use HH:MM');

export const hotelSchema = z.object({
  name: z.string().trim().min(1).max(200),
  slug: z
    .string()
    .trim()
    .min(2)
    .max(80)
    .regex(/^[a-z0-9-]+$/, 'lowercase letters, digits and dashes'),
  propertyType: z.enum(['hotel', 'resort', 'homestay', 'villa', 'hostel', 'other']).default('hotel'),
  description: z.string().max(5000).optional(),
  starRating: z.number().min(0).max(7).optional(),
  contact: z.object({ phone: z.string().optional(), email: optionalEmail, website: z.string().optional() }).partial().optional(),
  address: z
    .object({
      line1: z.string(),
      line2: z.string(),
      city: z.string(),
      state: z.string(),
      country: z.string(),
      postalCode: z.string(),
      mapsUrl: z.string(),
    })
    .partial()
    .optional(),
  timezone: z
    .string()
    .refine((tz) => {
      try {
        new Intl.DateTimeFormat('en-US', { timeZone: tz });
        return true;
      } catch {
        return false;
      }
    }, 'Unknown timezone')
    .default('Asia/Kolkata'),
  currency: z.string().length(3).default('INR'),
  checkInTime: hhmm.default('14:00'),
  checkOutTime: hhmm.default('11:00'),
  phoneNumbers: z.array(z.string()).default([]),
  amenities: z.array(z.string()).default([]),
  policies: z
    .object({
      petsAllowed: z.boolean(),
      smokingAllowed: z.boolean(),
      idRequired: z.string(),
      childPolicy: z.string(),
      other: z.array(z.string()),
    })
    .partial()
    .optional(),
  faqs: z.array(z.object({ question: z.string(), answer: z.string() })).optional(),
  taxPercent: z.number().min(0).max(100).default(12),
  payment: z
    .object({
      advanceMode: z.enum(['full', 'percentage', 'first_night', 'none']),
      advancePercent: z.number().min(0).max(100),
      holdMinutes: z.number().int().min(5).max(1440),
      allowPayAtHotel: z.boolean(),
    })
    .partial()
    .optional(),
  cancellation: z
    .object({ freeUntilHours: z.number().min(0), lateFeePercent: z.number().min(0).max(100), noShowFeePercent: z.number().min(0).max(100) })
    .partial()
    .optional(),
  agent: z.object({ greeting: z.string(), language: z.string(), instructions: z.string() }).partial().optional(),
  active: z.boolean().default(true),
});

export const userSchema = z.object({
  name: z.string().min(1).max(120),
  email: z.email(),
  password: z.string().min(8).max(200),
  role: z.enum(['super_admin', 'hotel_admin', 'staff']).default('staff'),
  hotels: z.array(objectId).default([]),
});
