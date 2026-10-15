import { config } from '../../config.js';
import { notFound } from '../../utils/errors.js';
import { histEntry } from '../bookings/history.js';
import * as bookings from '../bookings/repository.js';
import { raiseStaffTask } from '../calls/service.js';
import * as hotels from '../hotels/repository.js';
import { notifyGuest } from '../notifications/service.js';
import { round2 } from '../../utils/misc.js';
import { getProvider } from './providers/index.js';
import * as repo from './repository.js';

/** Cancels every unpaid payment link of a booking (at the gateway too). */
export async function cancelOpenPaymentLinks(booking) {
  for (const payment of await repo.openCharges(booking._id)) {
    if (payment.providerRef && payment.provider !== 'offline') await getProvider(payment.provider).cancelPaymentLink(payment.providerRef);
    await repo.cancelCharge(payment._id);
  }
}

/**
 * Creates a payment link for `amount` and sends it to the guest. A booking awaiting its advance is
 * bound to its hold window; other links stay valid for 24 hours.
 */
export async function createPaymentRequest(hotel, booking, amount, purpose) {
  const provider = getProvider();
  const payment = await repo.create({
    hotel: hotel._id,
    booking: booking._id,
    provider: provider.name,
    purpose,
    amount: round2(amount),
    currency: hotel.currency,
    expiresAt: booking.status === 'pending_payment' ? booking.holdExpiresAt : new Date(Date.now() + 24 * 3600 * 1000),
  });
  try {
    const { providerRef, url } = await provider.createPaymentLink({ payment, booking, hotel });
    payment.providerRef = providerRef;
    payment.paymentUrl = url;
    await payment.save();
  } catch (e) {
    payment.status = 'failed';
    payment.note = e.message;
    await payment.save();
    throw e;
  }
  await notifyGuest(hotel, booking, 'payment_link', { amount: payment.amount, url: payment.paymentUrl, expiresAt: payment.expiresAt });
  return payment;
}

/**
 * Refunds up to `amount` against the booking's paid charges, newest first. Gateway payments are refunded
 * through the gateway; offline payments (and gateway failures) become a manual task for the front desk.
 * @returns {Promise<number>} the amount that was actually refunded or queued for refund
 */
export async function refundBooking(hotel, booking, amount, actor) {
  let remaining = round2(amount);
  for (const charge of await repo.paidCharges(booking._id)) {
    if (remaining <= 0) break;
    const prior = await repo.refundsOf(charge._id);
    const refundable = round2(charge.amount - prior.reduce((sum, r) => sum + r.amount, 0));
    const take = Math.min(remaining, refundable);
    if (take <= 0) continue;

    const base = {
      hotel: hotel._id,
      booking: booking._id,
      kind: 'refund',
      purpose: 'refund',
      amount: take,
      currency: charge.currency,
      refundOf: charge._id,
      recordedBy: actor?.label,
    };
    if (charge.provider === 'offline') {
      await repo.create({
        ...base,
        provider: 'offline',
        method: charge.method,
        status: 'refund_pending',
        note: 'Return manually to guest (paid offline)',
      });
    } else {
      try {
        const result = await getProvider(charge.provider).refund({ payment: charge, amount: take });
        await repo.create({ ...base, provider: charge.provider, providerRef: result.providerRef, status: result.status });
      } catch (e) {
        await repo.create({ ...base, provider: charge.provider, status: 'refund_pending', note: `Automatic refund failed: ${e.message}` });
        await raiseStaffTask(hotel, booking, `Refund of ${take} for ${booking.code} failed at the gateway — process manually`);
      }
    }
    remaining = round2(remaining - take);
  }
  const refunded = round2(amount - remaining);
  if (refunded > 0) await bookings.addRefund(booking._id, refunded, histEntry('refund', actor, `Refund ${refunded}`));
  return refunded;
}

export const markRefundDelivered = repo.markRefundDelivered;
export const listPayments = repo.list;

/** Payment, booking and hotel behind the test-mode payment page (/pay/mock/:id). */
export async function loadMockCheckout(id) {
  if (config.paymentProvider !== 'mock') throw notFound('Page');
  const payment = await repo.findMockById(id);
  if (!payment) throw notFound('Payment');
  const [booking, hotel] = await Promise.all([bookings.findById(payment.booking), hotels.findById(payment.hotel)]);
  return { payment, booking, hotel };
}
