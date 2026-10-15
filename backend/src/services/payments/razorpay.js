import crypto from 'node:crypto';
import { config } from '../../config.js';
import { ApiError } from '../../utils/errors.js';

// Razorpay Payment Links: https://razorpay.com/docs/api/payments/payment-links/
const API = 'https://api.razorpay.com/v1';

async function call(path, body) {
  const { keyId, keySecret } = config.razorpay;
  if (!keyId || !keySecret) throw new ApiError(500, 'PAYMENT_CONFIG', 'Razorpay keys are not configured');
  const res = await fetch(`${API}${path}`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${Buffer.from(`${keyId}:${keySecret}`).toString('base64')}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body || {}),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(502, 'PAYMENT_PROVIDER_ERROR', data?.error?.description || `Razorpay error ${res.status}`);
  return data;
}

export const razorpayProvider = {
  name: 'razorpay',

  async createPaymentLink({ payment, booking, hotel }) {
    // Razorpay requires expire_by to be at least 15 minutes out.
    const expireBy = Math.max(payment.expiresAt.getTime(), Date.now() + 16 * 60 * 1000);
    const link = await call('/payment_links', {
      amount: Math.round(payment.amount * 100),
      currency: payment.currency,
      description: `${hotel.name} booking ${booking.code} (${booking.checkIn} to ${booking.checkOut})`,
      reference_id: String(payment._id),
      expire_by: Math.floor(expireBy / 1000),
      customer: { name: booking.guestName, contact: booking.guestPhone, email: booking.guestEmail || undefined },
      notify: { sms: false, email: false }, // we deliver the link on WhatsApp ourselves
      reminder_enable: true,
      callback_url: `${config.publicBaseUrl}/pay/return`,
      callback_method: 'get',
      notes: { bookingCode: booking.code, hotelId: String(hotel._id) },
    });
    return { providerRef: link.id, url: link.short_url };
  },

  async cancelPaymentLink(providerRef) {
    await call(`/payment_links/${providerRef}/cancel`).catch(() => {});
  },

  async refund({ payment, amount }) {
    const r = await call(`/payments/${payment.providerPaymentId}/refund`, { amount: Math.round(amount * 100), speed: 'normal' });
    return { providerRef: r.id, status: r.status === 'processed' ? 'refunded' : 'refund_pending', amount };
  },

  // Returns a normalized event, or null for events we don't act on. Throws on bad signature.
  parseWebhook(rawBody, headers) {
    const signature = headers['x-razorpay-signature'];
    const expected = crypto.createHmac('sha256', config.razorpay.webhookSecret || '').update(rawBody).digest('hex');
    if (!signature || signature.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) {
      throw new ApiError(400, 'BAD_SIGNATURE', 'Invalid Razorpay signature');
    }
    const event = JSON.parse(rawBody.toString('utf8'));
    const link = event.payload?.payment_link?.entity;
    const pay = event.payload?.payment?.entity;
    if (event.event === 'payment_link.paid' && link) {
      return { type: 'paid', providerRef: link.id, providerPaymentId: pay?.id, amount: (pay?.amount ?? link.amount_paid) / 100 };
    }
    if ((event.event === 'payment_link.expired' || event.event === 'payment_link.cancelled') && link) {
      return { type: 'expired', providerRef: link.id };
    }
    return null;
  },
};
