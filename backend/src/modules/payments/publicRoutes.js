import express, { Router } from 'express';
import { config } from '../../config.js';
import { notFound } from '../../utils/errors.js';
import { money } from '../../utils/money.js';
import { handlePaymentExpired, handlePaymentSuccess } from '../bookings/service.js';
import { getProvider } from './providers/index.js';
import { loadMockCheckout } from './service.js';

export const webhookRouter = Router();

// Gateways sign the raw body, so this route must see it before express.json().
webhookRouter.post('/:provider', express.raw({ type: '*/*', limit: '1mb' }), async (req, res) => {
  if (!['razorpay', 'stripe'].includes(req.params.provider)) throw notFound('Webhook');
  const provider = getProvider(req.params.provider);
  const event = provider.parseWebhook(req.body, req.headers);
  if (event?.type === 'paid') await handlePaymentSuccess(event);
  if (event?.type === 'expired') await handlePaymentExpired(event);
  res.json({ received: true });
});

// ---------- guest-facing pages ----------

export const payPagesRouter = Router();

const page = (
  title,
  body,
) => `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title}</title><style>
body{font-family:system-ui,sans-serif;background:#f4f5f7;margin:0;display:grid;place-items:center;min-height:100vh;color:#1d2433}
.card{background:#fff;border-radius:14px;padding:28px;max-width:380px;width:calc(100% - 32px);box-shadow:0 4px 20px rgba(0,0,0,.08)}
h1{font-size:20px;margin:0 0 4px}.muted{color:#667085;font-size:14px}.amt{font-size:32px;font-weight:700;margin:18px 0}
button{width:100%;padding:14px;border:0;border-radius:10px;background:#1f6feb;color:#fff;font-size:16px;font-weight:600;cursor:pointer}
.row{display:flex;justify-content:space-between;font-size:14px;padding:4px 0}.tag{display:inline-block;background:#fff4e5;color:#b54708;border-radius:6px;padding:2px 8px;font-size:12px;margin-bottom:12px}
</style></head><body><div class="card">${body}</div></body></html>`;

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

payPagesRouter.get('/mock/:id', async (req, res) => {
  const { payment, booking, hotel } = await loadMockCheckout(req.params.id);
  if (payment.status !== 'created') {
    return res.send(page('Payment', `<h1>${esc(hotel.name)}</h1><p class="muted">This payment link is ${esc(payment.status)}.</p>`));
  }
  res.send(
    page(
      'Pay',
      `<span class="tag">TEST MODE — no money moves</span>
<h1>${esc(hotel.name)}</h1><div class="muted">Booking ${esc(booking.code)} · ${esc(booking.guestName)}</div>
<div class="amt">${esc(money(payment.currency, payment.amount))}</div>
<div class="row"><span>${esc(booking.roomsCount)} × ${esc(booking.roomTypeName)}</span><span>${esc(booking.nights)} night(s)</span></div>
<div class="row"><span>${esc(booking.checkIn)} → ${esc(booking.checkOut)}</span><span>Total ${esc(money(booking.currency, booking.total))}</span></div>
<form method="post" style="margin-top:20px"><button>Pay now</button></form>`,
    ),
  );
});

payPagesRouter.post('/mock/:id', async (req, res) => {
  const { payment } = await loadMockCheckout(req.params.id);
  await handlePaymentSuccess({ paymentId: payment._id, providerPaymentId: `mock_pay_${Date.now()}` });
  res.redirect(303, `/pay/return?status=success&p=${payment._id}`);
});

payPagesRouter.get('/return', async (req, res) => {
  const ok = req.query.status !== 'cancelled';
  if (!ok) {
    return res.send(
      page(
        'Payment',
        '<h1>Payment not completed</h1><p class="muted">You can use the same link again before it expires, or call the hotel for a new one.</p>',
      ),
    );
  }
  // Show what was booked so the guest sees it right away (the confirmation message follows)
  const checkout = await loadMockCheckout(String(req.query.p ?? '')).catch(() => null);
  const via = config.guestChannels.map((c) => (c === 'email' ? 'email' : 'WhatsApp')).join(' and ') || 'message';
  const details = checkout
    ? `<div class="row"><span>Booking</span><b>${esc(checkout.booking.code)}</b></div>
<div class="row"><span>${esc(checkout.booking.roomsCount)} × ${esc(checkout.booking.roomTypeName)}</span><span>${esc(checkout.booking.nights)} night(s)</span></div>
<div class="row"><span>${esc(checkout.booking.checkIn)} → ${esc(checkout.booking.checkOut)}</span><span></span></div>
<div class="row"><span>Paid</span><span>${esc(money(checkout.payment.currency, checkout.payment.amount))}</span></div>
<div class="row"><span>Confirmation sent to</span><span>${esc(checkout.booking.guestEmail || checkout.booking.guestPhone)}</span></div>`
    : '';
  res.send(
    page(
      'Payment',
      `<h1>Payment received ✓</h1><p class="muted">Thank you! Your booking is confirmed. A confirmation will arrive by ${esc(via)} shortly.</p>${details}`,
    ),
  );
});
