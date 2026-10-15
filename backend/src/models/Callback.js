import mongoose from 'mongoose';

const { Schema } = mongoose;

// A request for a human to follow up (agent hand-off, payment issue, complaint, ...)
const callbackSchema = new Schema(
  {
    hotel: { type: Schema.Types.ObjectId, ref: 'Hotel', required: true },
    name: String,
    phone: { type: String, required: true },
    reason: { type: String, required: true },
    priority: { type: String, enum: ['low', 'normal', 'high'], default: 'normal' },
    booking: { type: Schema.Types.ObjectId, ref: 'Booking' },
    callId: String,
    status: { type: String, enum: ['open', 'in_progress', 'done'], default: 'open' },
    assignedTo: String,
    notes: String,
    createdBy: String,
  },
  { timestamps: true },
);

callbackSchema.index({ hotel: 1, status: 1, createdAt: -1 });

export const Callback = mongoose.model('Callback', callbackSchema);
