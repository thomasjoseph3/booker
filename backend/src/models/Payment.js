import mongoose from 'mongoose';

const { Schema } = mongoose;

const paymentSchema = new Schema(
  {
    hotel: { type: Schema.Types.ObjectId, ref: 'Hotel', required: true },
    booking: { type: Schema.Types.ObjectId, ref: 'Booking', required: true, index: true },
    kind: { type: String, enum: ['charge', 'refund'], default: 'charge' },
    purpose: { type: String, enum: ['advance', 'balance', 'top_up', 'refund'], default: 'advance' },
    provider: { type: String, required: true }, // mock | razorpay | stripe | offline
    providerRef: { type: String, index: true }, // payment link / checkout session / refund id
    providerPaymentId: String, // the captured payment id (needed for refunds)
    method: { type: String, enum: ['online', 'cash', 'card', 'upi', 'bank_transfer', 'other'], default: 'online' },
    amount: { type: Number, required: true },
    currency: String,
    status: { type: String, enum: ['created', 'paid', 'failed', 'expired', 'cancelled', 'refund_pending', 'refunded'], default: 'created' },
    paymentUrl: String,
    expiresAt: Date,
    paidAt: Date,
    refundOf: { type: Schema.Types.ObjectId, ref: 'Payment' },
    recordedBy: String,
    note: String,
  },
  { timestamps: true },
);

paymentSchema.index({ hotel: 1, createdAt: -1 });

export const Payment = mongoose.model('Payment', paymentSchema);
