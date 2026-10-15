import mongoose from 'mongoose';

const { Schema } = mongoose;

// Every outbound message to a guest (payment link, confirmation, cancellation).
const notificationSchema = new Schema(
  {
    hotel: { type: Schema.Types.ObjectId, ref: 'Hotel', required: true },
    booking: { type: Schema.Types.ObjectId, ref: 'Booking' },
    channel: { type: String, enum: ['sms', 'whatsapp', 'email'], required: true },
    to: String,
    template: String,
    message: String,
    status: { type: String, enum: ['logged', 'sent', 'failed'], default: 'logged' },
    error: String,
    providerMessageId: String,
  },
  { timestamps: true },
);

notificationSchema.index({ hotel: 1, createdAt: -1 });

export const Notification = mongoose.model('Notification', notificationSchema);
