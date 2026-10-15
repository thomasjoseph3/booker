import crypto from 'node:crypto';
import { config } from '../../config.js';
import { ApiError } from '../../utils/errors.js';

// Stripe Checkout Sessions: https://docs.stripe.com/api/checkout/sessions
const API = 'https://api.stripe.com/v1';

async function call(path, params) {
  if (!config.stripe.secretKey) throw new ApiError(500, 'PAYMENT_CONFIG', 'Stripe key is not configured');
  const res = await fetch(`${API}${path}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${config.stripe.secretKey}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(params || {}),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(502, 'PAYMENT_PROVIDER_ERROR', data?.error?.message || `Stripe error ${res.status}`);
  return data;
}

export const stripeProvider = {
  name: 'stripe',

  async createPaymentLink({ payment, booking, hotel }) {
    // Checkout sessions must live at least 30 minutes.
    const expiresAt = Math.max(payment.expiresAt.getTime(), Date.now() + 31 * 60 * 1000);
    const params = {
      mode: 'payment',
      'line_items[0][quantity]': '1',
      'line_items[0][price_data][currency]': payment.currency.toLowerCase(),
      'line_items[0][price_data][unit_amount]': String(Math.round(payment.amount * 100)),
      'line_items[0][price_data][product_data][name]': `${hotel.name} — booking ${booking.code}`,
      'line_items[0][price_data][product_data][description]': `${booking.roomTypeName}, ${booking.checkIn} to ${booking.checkOut}`,
      client_reference_id: String(payment._id),
      'metadata[paymentId]': String(payment._id),
      'metadata[bookingCode]': booking.code,
      expires_at: String(Math.floor(expiresAt / 1000)),
      success_url: `${config.publicBaseUrl}/pay/return?status=success`,
      cancel_url: `${config.publicBaseUrl}/pay/return?status=cancelled`,
    };
    if (booking.guestEmail) params.customer_email = booking.guestEmail;
    const session = await call('/checkout/sessions', params);
    return { providerRef: session.id, url: session.url };
  },

  async cancelPaymentLink(providerRef) {
    await call(`/checkout/sessions/${providerRef}/expire`).catch(() => {});
  },

  async refund({ payment, amount }) {
    const r = await call('/refunds', { payment_intent: payment.providerPaymentId, amount: String(Math.round(amount * 100)) });
    return { providerRef: r.id, status: r.status === 'succeeded' ? 'refunded' : 'refund_pending', amount };
  },

  parseWebhook(rawBody, headers) {
    const header = headers['stripe-signature'] || '';
    const parts = Object.fromEntries(header.split(',').map((kv) => kv.split('=')));
    const expected = crypto
      .createHmac('sha256', config.stripe.webhookSecret || '')
      .update(`${parts.t}.${rawBody.toString('utf8')}`)
      .digest('hex');
    const ok = parts.v1 && parts.v1.length === expected.length && crypto.timingSafeEqual(Buffer.from(parts.v1), Buffer.from(expected));
    if (!ok || Math.abs(Date.now() / 1000 - Number(parts.t)) > 300) {
      throw new ApiError(400, 'BAD_SIGNATURE', 'Invalid Stripe signature');
    }
    const event = JSON.parse(rawBody.toString('utf8'));
    const session = event.data?.object;
    if (event.type === 'checkout.session.completed' && session?.payment_status === 'paid') {
      return { type: 'paid', providerRef: session.id, providerPaymentId: session.payment_intent, amount: session.amount_total / 100 };
    }
    if (event.type === 'checkout.session.expired') return { type: 'expired', providerRef: session.id };
    return null;
  },
};
