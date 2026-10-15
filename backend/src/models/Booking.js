import mongoose from 'mongoose';

const { Schema } = mongoose;

export const BOOKING_STATUSES = ['pending_payment', 'confirmed', 'checked_in', 'checked_out', 'cancelled', 'expired', 'no_show'];

const bookingSchema = new Schema(
  {
    hotel: { type: Schema.Types.ObjectId, ref: 'Hotel', required: true },
    code: { type: String, required: true, unique: true },
    guest: { type: Schema.Types.ObjectId, ref: 'Guest', required: true },
    guestName: String,
    guestPhone: String,
    guestEmail: String,
    roomType: { type: Schema.Types.ObjectId, ref: 'RoomType', required: true },
    roomTypeName: String,
    roomsCount: { type: Number, default: 1, min: 1 },
    checkIn: { type: String, required: true },
    checkOut: { type: String, required: true },
    nights: Number,
    adults: { type: Number, required: true, min: 1 },
    children: { type: Number, default: 0, min: 0 },
    assignedRooms: [{ type: Schema.Types.ObjectId, ref: 'Room' }],
    checkedInAt: Date,
    checkedOutAt: Date, // when the guest actually vacated
    nightlyRates: [{ date: String, price: Number, _id: false }],
    currency: String,
    subtotal: Number,
    tax: Number,
    total: Number,
    advanceDue: Number,
    amountPaid: { type: Number, default: 0 },
    amountRefunded: { type: Number, default: 0 },
    paymentMode: { type: String, enum: ['online', 'pay_at_hotel'], default: 'online' },
    status: { type: String, enum: BOOKING_STATUSES, required: true },
    holdExpiresAt: Date,
    inventoryHeld: { type: Boolean, default: false },
    // First night given back to inventory (early departure / no-show / cancellation). Nights before it stay sold.
    inventoryReleasedFrom: String,
    source: { type: String, enum: ['phone_agent', 'admin', 'walk_in', 'website', 'ota'], default: 'phone_agent' },
    specialRequests: String,
    callId: String,
    cancellation: {
      at: Date,
      by: String,
      reason: String,
      fee: Number,
      refundAmount: Number,
    },
    history: [{ at: { type: Date, default: Date.now }, action: String, by: String, note: String, _id: false }],
  },
  { timestamps: true },
);

bookingSchema.index({ hotel: 1, checkIn: 1 });
bookingSchema.index({ hotel: 1, status: 1 });
bookingSchema.index({ hotel: 1, guestPhone: 1 });
bookingSchema.index({ status: 1, holdExpiresAt: 1 });

bookingSchema.virtual('balanceDue').get(function balanceDue() {
  if (['cancelled', 'expired'].includes(this.status)) return 0;
  return Math.max(0, Math.round(((this.total || 0) - (this.amountPaid || 0) + (this.amountRefunded || 0)) * 100) / 100);
});

bookingSchema.set('toJSON', { virtuals: true });
bookingSchema.set('toObject', { virtuals: true });

export const Booking = mongoose.model('Booking', bookingSchema);
