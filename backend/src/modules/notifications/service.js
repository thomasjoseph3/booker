import { Callback, Notification } from '../../models/index.js';
import { sendWhatsApp } from './channels/whatsapp.js';
import { emailEnabled, emailRecipient, sendEmail } from './channels/email.js';
import { config } from '../../config.js';

/**
 * Guest messages. Every message goes to the guest's WhatsApp and is stored in the
 * notifications collection so admins can see exactly what was sent.
 * Each template returns `text` (free-form) and `params` (ordered variables for an
 * approved WhatsApp template with the same meaning).
 */

const money = (hotel, n) => `${hotel.currency} ${Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
const prettyDay = (day) => new Date(`${day}T00:00:00Z`).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
const time12 = (hhmm) => {
  const [h, m] = hhmm.split(':').map(Number);
  return `${((h + 11) % 12) + 1}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
};
const addressLine = (h) => [h.address?.line1, h.address?.line2, h.address?.city, h.address?.state, h.address?.postalCode].filter(Boolean).join(', ');
const mapsLink = (h) => h.address?.mapsUrl || `https://maps.google.com/?q=${encodeURIComponent(`${h.name}, ${addressLine(h)}`)}`;
const paidNet = (b) => (b.amountPaid || 0) - (b.amountRefunded || 0);

const templates = {
  payment_link: (h, b, x) => {
    const until = x.expiresAt?.toLocaleTimeString('en-IN', { timeZone: h.timezone, hour: 'numeric', minute: '2-digit' });
    return {
      text:
        `*${h.name}*\n\nHi ${b.guestName}, thank you for calling us! 🙏\n\n` +
        `Your room is *on hold* — booking *${b.code}*\n` +
        `🛏 ${b.roomsCount} × ${b.roomTypeName}\n📅 ${prettyDay(b.checkIn)} → ${prettyDay(b.checkOut)} (${b.nights} night${b.nights > 1 ? 's' : ''})\n` +
        `👥 ${b.adults} adult(s)${b.children ? `, ${b.children} child(ren)` : ''}\n💰 Total ${money(h, b.total)}\n\n` +
        `To confirm, please pay the advance of *${money(h, x.amount)}* here:\n${x.url}\n\n` +
        (until ? `⏳ The room is held until *${until}*. If the advance isn't received by then, the hold is released automatically.` : ''),
      params: [b.guestName, h.name, b.code, b.roomTypeName, b.checkIn, b.checkOut, money(h, x.amount), until || '', x.url],
    };
  },

  confirmed: (h, b) => {
    const balance = Math.max(0, b.total - paidNet(b));
    const lines = [
      `*${h.name}* ✅ *Booking confirmed*`,
      '',
      `Hi ${b.guestName}, we've received your payment. See you soon!`,
      '',
      `*Booking:* ${b.code}`,
      `*Room:* ${b.roomsCount} × ${b.roomTypeName}`,
      `*Guests:* ${b.adults} adult(s)${b.children ? `, ${b.children} child(ren)` : ''}`,
      `*Check-in:* ${prettyDay(b.checkIn)}, from ${time12(h.checkInTime)}`,
      `*Check-out:* ${prettyDay(b.checkOut)}, by ${time12(h.checkOutTime)}`,
      '',
      `*Total:* ${money(h, b.total)}`,
      `*Paid:* ${money(h, paidNet(b))}`,
      balance > 0 ? `*Balance payable at the hotel:* ${money(h, balance)}` : '*Fully paid*',
      '',
      `📍 *Address:* ${addressLine(h)}`,
      `🗺 ${mapsLink(h)}`,
      h.contact?.phone ? `📞 Front desk: ${h.contact.phone}` : null,
      '',
      '*Before you arrive*',
      `• ${h.policies?.idRequired || 'Please carry a government-issued photo ID.'}`,
      h.policies?.childPolicy ? `• ${h.policies.childPolicy}` : null,
      ...(h.policies?.other || []).map((o) => `• ${o}`),
      b.specialRequests ? `• Your request noted: "${b.specialRequests}"` : null,
      '',
      `Free cancellation until ${h.cancellation?.freeUntilHours ?? 48} hours before check-in. Reply here or call us for any changes.`,
    ];
    return {
      text: lines.filter((l) => l !== null).join('\n'),
      params: [b.guestName, h.name, b.code, b.roomTypeName, b.checkIn, time12(h.checkInTime), b.checkOut, time12(h.checkOutTime), money(h, paidNet(b)), money(h, balance), addressLine(h), mapsLink(h)],
    };
  },

  modified: (h, b) => ({
    text: `*${h.name}*\n\nBooking *${b.code}* has been updated:\n🛏 ${b.roomsCount} × ${b.roomTypeName}\n📅 ${prettyDay(b.checkIn)} → ${prettyDay(b.checkOut)}\n💰 New total ${money(h, b.total)} (paid ${money(h, paidNet(b))})`,
    params: [b.guestName, h.name, b.code, b.roomTypeName, b.checkIn, b.checkOut, money(h, b.total)],
  }),

  cancelled: (h, b, x) => ({
    text: `*${h.name}*\n\nBooking *${b.code}* has been cancelled.` + (x.refundAmount > 0 ? `\nA refund of *${money(h, x.refundAmount)}* has been initiated to your original payment method (5–7 working days).` : '') + '\n\nWe hope to host you another time.',
    params: [b.guestName, h.name, b.code, money(h, x.refundAmount || 0)],
  }),

  expired: (h, b) => ({
    text: `*${h.name}*\n\nHi ${b.guestName}, the hold on booking *${b.code}* (${prettyDay(b.checkIn)}) was released because the advance wasn't received within the time limit.\nCall us anytime to book again${h.contact?.phone ? `: ${h.contact.phone}` : ''}.`,
    params: [b.guestName, h.name, b.code, b.checkIn],
  }),

  payment_issue: (h, b) => ({
    text: `*${h.name}*\n\nWe received your payment for *${b.code}*, but the room was no longer available because the hold had expired. A *full refund* has been initiated and our team will call you shortly to help rebook.`,
    params: [b.guestName, h.name, b.code],
  }),
};

export async function notifyGuest(hotel, booking, template, extra = {}) {
  const message = templates[template](hotel, booking, extra);
  const critical = ['payment_link', 'confirmed'].includes(template);
  const deliver = async (channel, to, send) => {
    let result;
    try {
      result = await send();
    } catch (e) {
      result = { status: 'failed', error: e.message };
      console.error(`[notify] ${channel} ${template} to ${to} failed: ${e.message}`);
    }
    await Notification.create({ hotel: hotel._id, booking: booking._id, channel, to, template, message: message.text, ...result });
    if (process.env.NODE_ENV !== 'test') console.log(`[${channel}:${result.status}] ${template} -> ${to}`);
    return result;
  };

  const results = [];
  if (config.guestChannels.includes('whatsapp')) {
    results.push(await deliver('whatsapp', booking.guestPhone, () => sendWhatsApp(booking.guestPhone, { ...message, template })));
  }
  if (emailEnabled()) {
    const to = emailRecipient(booking);
    if (to) results.push(await deliver('email', to, () => sendEmail(to, { ...message, template, hotel, booking })));
  }

  // Nobody got the important messages -> ask the front desk to share it manually.
  if (critical && !results.some((r) => r.status !== 'failed')) {
    const err = results.map((r) => r.error).filter(Boolean)[0] || 'no delivery channel available';
    await Callback.create({
      hotel: hotel._id, name: booking.guestName, phone: booking.guestPhone, booking: booking._id, priority: 'high', createdBy: 'system',
      reason: `"${template.replace('_', ' ')}" for ${booking.code} could not be delivered (${err}). Share it with the guest manually.`,
    });
  }
  return message.text;
}

// Used by the demo-data generator to produce realistic message history.
export function renderMessage(template, hotel, booking, extra = {}) {
  return templates[template](hotel, booking, extra).text;
}
