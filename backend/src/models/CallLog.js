import mongoose from 'mongoose';

const { Schema } = mongoose;

const callLogSchema = new Schema(
  {
    hotel: { type: Schema.Types.ObjectId, ref: 'Hotel', required: true },
    callId: { type: String, required: true }, // id from the telephony provider / agent runtime
    direction: { type: String, enum: ['inbound', 'outbound'], default: 'inbound' },
    fromNumber: String,
    toNumber: String,
    guest: { type: Schema.Types.ObjectId, ref: 'Guest' },
    startedAt: Date,
    endedAt: Date,
    durationSec: Number,
    // `data` carries debugging detail for tool calls ({ name, args, ok, ms, result, error }) and errors
    transcript: [
      { role: { type: String, enum: ['caller', 'agent', 'system', 'tool'] }, text: String, at: Date, data: Schema.Types.Mixed, _id: false },
    ],
    channel: { type: String, enum: ['web_live', 'phone'] }, // how the call reached the agent
    model: String, // the AI model that handled it
    language: String, // main language the caller spoke (English, Malayalam, Mixed, ...)
    summary: String,
    intent: String,
    outcome: { type: String, enum: ['booked', 'cancelled', 'modified', 'inquiry', 'callback_requested', 'abandoned', 'other'] },
    sentiment: { type: String, enum: ['positive', 'neutral', 'negative'] },
    bookings: [{ type: Schema.Types.ObjectId, ref: 'Booking' }],
    recordingUrl: String,
  },
  { timestamps: true },
);

callLogSchema.index({ hotel: 1, callId: 1 }, { unique: true });
callLogSchema.index({ hotel: 1, createdAt: -1 });

export const CallLog = mongoose.model('CallLog', callLogSchema);
