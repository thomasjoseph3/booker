import mongoose from 'mongoose';

const { Schema } = mongoose;

const rateOverrideSchema = new Schema(
  {
    from: { type: String, required: true }, // inclusive night, YYYY-MM-DD
    to: { type: String, required: true }, // inclusive night
    price: { type: Number, required: true, min: 0 },
    label: String, // e.g. "Christmas peak"
  },
  { _id: true },
);

const roomTypeSchema = new Schema(
  {
    hotel: { type: Schema.Types.ObjectId, ref: 'Hotel', required: true, index: true },
    name: { type: String, required: true, trim: true },
    code: { type: String, required: true, uppercase: true, trim: true },
    description: String,
    bedType: String,
    sizeSqft: Number,
    view: String,
    maxAdults: { type: Number, default: 2, min: 1 },
    maxChildren: { type: Number, default: 1, min: 0 },
    maxOccupancy: { type: Number, default: 3, min: 1 },
    amenities: { type: [String], default: [] },
    images: { type: [String], default: [] },
    basePrice: { type: Number, required: true, min: 0 }, // per room per night, before tax
    weekendPrice: { type: Number, min: 0 }, // Fri/Sat nights
    rateOverrides: { type: [rateOverrideSchema], default: [] },
    // Sellable inventory. Kept in sync with physical Room records when the hotel manages them.
    totalRooms: { type: Number, required: true, min: 0 },
    active: { type: Boolean, default: true },
  },
  { timestamps: true },
);

roomTypeSchema.index({ hotel: 1, code: 1 }, { unique: true });

export const RoomType = mongoose.model('RoomType', roomTypeSchema);
