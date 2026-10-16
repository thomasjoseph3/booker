import mongoose from 'mongoose';

const { Schema } = mongoose;

// A percentage off the room charge (before tax) for stays that meet its conditions. Applied automatically:
// when several qualify, the guest gets the biggest one (offers do not stack).
const offerSchema = new Schema(
  {
    hotel: { type: Schema.Types.ObjectId, ref: 'Hotel', required: true },
    name: { type: String, required: true, trim: true },
    description: String,
    percentOff: { type: Number, required: true, min: 1, max: 90 },
    // Conditions: all must be met. Empty / zero means "no condition".
    minNights: { type: Number, default: 0, min: 0 },
    bookAheadDays: { type: Number, default: 0, min: 0 }, // book at least this many days before check-in
    stayFrom: String, // every night of the stay must fall inside [stayFrom, stayTo]
    stayTo: String,
    bookUntil: String, // the offer can only be booked up to this day (inclusive)
    roomTypes: [{ type: Schema.Types.ObjectId, ref: 'RoomType' }], // empty = all room types
    active: { type: Boolean, default: true },
  },
  { timestamps: true },
);

offerSchema.index({ hotel: 1, active: 1 });

export const Offer = mongoose.model('Offer', offerSchema);
