import mongoose from 'mongoose';

const { Schema } = mongoose;

const guestSchema = new Schema(
  {
    hotel: { type: Schema.Types.ObjectId, ref: 'Hotel', required: true },
    name: { type: String, required: true, trim: true },
    phone: { type: String, required: true },
    email: { type: String, lowercase: true, trim: true },
    notes: String,
    vip: { type: Boolean, default: false },
  },
  { timestamps: true },
);

guestSchema.index({ hotel: 1, phone: 1 }, { unique: true });

export const Guest = mongoose.model('Guest', guestSchema);
