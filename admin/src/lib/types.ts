export type Role = "super_admin" | "hotel_admin" | "staff";
export type BookingStatus = "pending_payment" | "confirmed" | "checked_in" | "checked_out" | "cancelled" | "expired" | "no_show";
export type BookingSource = "phone_agent" | "admin" | "walk_in" | "website" | "ota";

export interface User { id: string; name: string; email: string; role: Role; hotels: string[] }

export interface Hotel {
  _id: string;
  name: string;
  slug: string;
  propertyType: string;
  description?: string;
  starRating?: number;
  contact?: { phone?: string; email?: string; website?: string };
  address?: { line1?: string; line2?: string; city?: string; state?: string; country?: string; postalCode?: string; mapsUrl?: string };
  timezone: string;
  currency: string;
  checkInTime: string;
  checkOutTime: string;
  phoneNumbers: string[];
  amenities: string[];
  policies?: { petsAllowed?: boolean; smokingAllowed?: boolean; idRequired?: string; childPolicy?: string; other?: string[] };
  faqs: { question: string; answer: string }[];
  taxPercent: number;
  payment: { advanceMode: "full" | "percentage" | "first_night" | "none"; advancePercent: number; holdMinutes: number; allowPayAtHotel: boolean };
  cancellation: { freeUntilHours: number; lateFeePercent: number; noShowFeePercent: number };
  agent?: { apiKeyPreview?: string; greeting?: string; language?: string; instructions?: string };
  active: boolean;
}

export interface HistoryEntry { at: string; action: string; by: string; note?: string }

export interface Booking {
  _id: string;
  code: string;
  guest: string | Guest;
  guestName: string;
  guestPhone: string;
  guestEmail?: string;
  roomType: string;
  roomTypeName: string;
  roomsCount: number;
  checkIn: string;
  checkOut: string;
  nights: number;
  adults: number;
  children: number;
  assignedRooms: { _id: string; number: string; floor?: string }[];
  checkedInAt?: string;
  checkedOutAt?: string;
  nightlyRates?: { date: string; price: number }[];
  currency: string;
  subtotal: number;
  tax: number;
  total: number;
  advanceDue: number;
  amountPaid: number;
  amountRefunded: number;
  balanceDue: number;
  paymentMode: "online" | "pay_at_hotel";
  status: BookingStatus;
  holdExpiresAt?: string;
  source: BookingSource;
  specialRequests?: string;
  cancellation?: { at?: string; by?: string; reason?: string; fee?: number; refundAmount?: number };
  history: HistoryEntry[];
  createdAt: string;
}

export interface Payment {
  _id: string;
  booking: string | { _id: string; code: string; guestName: string };
  kind: "charge" | "refund";
  purpose: string;
  provider: string;
  method: string;
  amount: number;
  currency: string;
  status: string;
  paymentUrl?: string;
  paidAt?: string;
  createdAt: string;
  note?: string;
}

export interface Notification {
  _id: string;
  booking?: string | { _id: string; code: string };
  channel: string;
  to: string;
  template?: string;
  message: string;
  status: string;
  error?: string;
  createdAt: string;
}

export interface CallLog {
  _id: string;
  callId: string;
  fromNumber?: string;
  toNumber?: string;
  guest?: string | Guest;
  startedAt?: string;
  endedAt?: string;
  durationSec?: number;
  transcript?: { role: "caller" | "agent" | "system" | "tool"; text: string; at?: string; data?: Record<string, unknown> }[];
  channel?: "web_live" | "phone";
  model?: string;
  summary?: string;
  intent?: string;
  outcome?: string;
  sentiment?: string;
  bookings: { _id: string; code: string; status: BookingStatus; checkIn?: string; checkOut?: string }[];
  recordingUrl?: string;
  createdAt: string;
}

export interface Guest {
  _id: string;
  name: string;
  phone: string;
  email?: string;
  notes?: string;
  vip: boolean;
  createdAt: string;
  bookings?: number;
  stays?: number;
  spent?: number;
  lastStay?: string | null;
}

export interface RoomType {
  _id: string;
  name: string;
  code: string;
  description?: string;
  bedType?: string;
  sizeSqft?: number;
  view?: string;
  maxAdults: number;
  maxChildren: number;
  maxOccupancy: number;
  amenities: string[];
  images: string[];
  basePrice: number;
  weekendPrice?: number | null;
  rateOverrides: { _id?: string; from: string; to: string; price: number; label?: string }[];
  totalRooms: number;
  active: boolean;
}

export interface RoomStay {
  code: string; guestName: string; checkIn: string; checkOut: string; checkedInAt?: string; checkedOutAt?: string; adults: number; children: number;
}

export interface Room {
  _id: string;
  number: string;
  floor?: string;
  status: "available" | "occupied" | "cleaning" | "out_of_service";
  roomType: { _id: string; name: string; code: string };
  notes?: string;
  currentStay?: RoomStay | null; // guest in the room now
  lastStay?: RoomStay | null; // most recent guest who checked out
}

export interface Page<T> { items: T[]; total: number; page: number; pages: number }

export interface Quote {
  currency: string; nights: number; roomsCount: number; nightlyRates: { date: string; price: number }[];
  averageNightlyRate: number; subtotal: number; tax: number; taxPercent: number; total: number; advanceDue: number;
}

export interface AvailabilityOption {
  roomTypeId: string; code: string; name: string; description?: string; bedType?: string; view?: string; sizeSqft?: number;
  maxAdults: number; maxChildren: number; maxOccupancy: number; amenities: string[];
  availableRooms: number; roomsNeeded: number | null; bookable: boolean; reason?: string; quote: Quote;
}

export interface CancellationQuote {
  cancellable: boolean; reason?: string; freeCancellation?: boolean; hoursBeforeCheckIn?: number; freeUntilHours?: number;
  amountPaid?: number; fee?: number; refundAmount?: number; currency?: string; policy?: string;
}

export interface ToolTrace {
  name: string;
  args: Record<string, unknown>;
  ok: boolean;
  ms: number;
  error?: string;
  result?: string;
}

export interface ChatMessage {
  role: "user" | "assistant" | "system";
  text: string;
  at: string;
  tools?: ToolTrace[];
  model?: string;
  ms?: number;
}

export interface AssistantChat {
  _id: string;
  title: string;
  messageCount: number;
  lastMessageAt: string;
  user?: { _id: string; name: string; email: string };
  messages?: ChatMessage[];
}
