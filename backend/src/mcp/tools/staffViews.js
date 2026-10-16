import { round2 } from '../../utils/misc.js';

// Compact shapes of hotel data for the staff assistant: enough to answer questions, small enough to keep the model fast.

const plain = (doc) => (doc?.toObject ? doc.toObject() : doc);

export function bookingBrief(b) {
  const x = plain(b);
  return {
    code: x.code,
    status: x.status,
    guest: x.guestName,
    phone: x.guestPhone,
    room: `${x.roomsCount} × ${x.roomTypeName}`,
    checkIn: x.checkIn,
    checkOut: x.checkOut,
    nights: x.nights,
    adults: x.adults,
    children: x.children,
    total: x.total,
    paid: round2((x.amountPaid || 0) - (x.amountRefunded || 0)),
    balanceDue: x.balanceDue,
    source: x.source,
    holdExpiresAt: x.status === 'pending_payment' ? x.holdExpiresAt : undefined,
  };
}

export const callbackBrief = (c) => ({
  id: String(c._id),
  status: c.status,
  priority: c.priority,
  name: c.name,
  phone: c.phone,
  reason: c.reason,
  booking: c.booking?.code,
  assignedTo: c.assignedTo,
  createdAt: c.createdAt,
});

export const callBrief = (c) => ({
  id: String(c._id),
  at: c.startedAt || c.createdAt,
  channel: c.channel,
  from: c.fromNumber,
  durationSec: c.durationSec,
  outcome: c.outcome,
  intent: c.intent,
  sentiment: c.sentiment,
  summary: c.summary,
  bookings: (c.bookings || []).map((b) => b.code).filter(Boolean),
});

export const paymentBrief = (p) => ({
  id: String(p._id),
  kind: p.kind,
  status: p.status,
  amount: p.amount,
  currency: p.currency,
  purpose: p.purpose,
  provider: p.provider,
  method: p.method,
  booking: p.booking?.code,
  guest: p.booking?.guestName,
  at: p.paidAt || p.createdAt,
  note: p.note,
});

export const guestBrief = (g) => ({
  id: String(g._id),
  name: g.name,
  phone: g.phone,
  email: g.email,
  vip: g.vip,
  bookings: g.bookings,
  stays: g.stays,
  spent: g.spent,
  lastStay: g.lastStay,
});

export const roomBrief = (r) => ({
  number: r.number,
  floor: r.floor,
  type: r.roomType?.name,
  status: r.status,
  currentGuest: r.currentStay ? `${r.currentStay.guestName} (${r.currentStay.code}, out ${r.currentStay.checkOut})` : undefined,
});
