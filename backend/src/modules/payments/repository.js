import { Payment } from '../../models/index.js';
import { paginate } from '../../utils/pagination.js';

export const create = (data) => Payment.create(data);

export const findById = (id) => Payment.findById(id);

export const findMockById = (id) => Payment.findOne({ _id: id, provider: 'mock' });

export const forBooking = (bookingId) => Payment.find({ booking: bookingId }).sort({ createdAt: 1 });

export const list = (hotelId, { status, kind }, page) =>
  paginate(Payment, { hotel: hotelId, ...(status ? { status: { $in: status.split(',') } } : {}), ...(kind ? { kind } : {}) }, page, {
    populate: ['booking', 'code guestName'],
  });

/** The newest payment link that is still waiting to be paid. */
export const latestOpenCharge = (bookingId) =>
  Payment.findOne({ booking: bookingId, kind: 'charge', status: 'created' }).sort({ createdAt: -1 });

export const openCharges = (bookingId) => Payment.find({ booking: bookingId, kind: 'charge', status: 'created' });

export const paidCharges = (bookingId) => Payment.find({ booking: bookingId, kind: 'charge', status: 'paid' }).sort({ paidAt: -1 });

export const refundsOf = (chargeId) => Payment.find({ refundOf: chargeId, status: { $in: ['refunded', 'refund_pending'] } });

export const cancelCharge = (id) => Payment.updateOne({ _id: id, status: 'created' }, { $set: { status: 'cancelled' } });

/**
 * Atomically marks a charge as paid, so a retried webhook cannot be processed twice.
 * Returns null when the charge is unknown or was already settled.
 */
export const claimAsPaid = ({ paymentId, providerRef, providerPaymentId }) =>
  Payment.findOneAndUpdate(
    {
      ...(paymentId ? { _id: paymentId } : { providerRef }),
      kind: 'charge',
      status: { $in: ['created', 'expired', 'cancelled', 'failed'] },
    },
    { $set: { status: 'paid', paidAt: new Date(), ...(providerPaymentId ? { providerPaymentId } : {}) } },
    { returnDocument: 'after' },
  );

export const setAmount = (id, amount) => Payment.updateOne({ _id: id }, { $set: { amount } });

export const expireByProviderRef = (providerRef) => Payment.updateOne({ providerRef, status: 'created' }, { $set: { status: 'expired' } });

export const expireOverdueCharges = (now) =>
  Payment.updateMany({ kind: 'charge', status: 'created', expiresAt: { $lte: now } }, { $set: { status: 'expired' } });

/** Front desk confirms a manual refund was handed back to the guest. */
export const markRefundDelivered = (hotelId, id, recordedBy) =>
  Payment.findOneAndUpdate(
    { _id: id, hotel: hotelId, kind: 'refund', status: 'refund_pending' },
    { $set: { status: 'refunded', recordedBy } },
    { returnDocument: 'after' },
  );
