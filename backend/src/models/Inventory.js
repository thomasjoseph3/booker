import mongoose from 'mongoose';

const { Schema } = mongoose;

// One document per room type per night. `booked` is changed only with atomic,
// conditional $inc so two callers can never both take the last room.
const inventorySchema = new Schema(
  {
    hotel: { type: Schema.Types.ObjectId, ref: 'Hotel', required: true },
    roomType: { type: Schema.Types.ObjectId, ref: 'RoomType', required: true },
    date: { type: String, required: true },
    booked: { type: Number, default: 0, min: 0 },
    closed: { type: Boolean, default: false }, // stop-sell
  },
  { timestamps: true },
);

inventorySchema.index({ roomType: 1, date: 1 }, { unique: true });
inventorySchema.index({ hotel: 1, date: 1 });

export const Inventory = mongoose.model('Inventory', inventorySchema);
