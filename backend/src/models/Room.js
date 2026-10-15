import mongoose from 'mongoose';

const { Schema } = mongoose;

const roomSchema = new Schema(
  {
    hotel: { type: Schema.Types.ObjectId, ref: 'Hotel', required: true, index: true },
    roomType: { type: Schema.Types.ObjectId, ref: 'RoomType', required: true, index: true },
    number: { type: String, required: true, trim: true },
    floor: String,
    status: { type: String, enum: ['available', 'occupied', 'cleaning', 'out_of_service'], default: 'available' },
    notes: String,
  },
  { timestamps: true },
);

roomSchema.index({ hotel: 1, number: 1 }, { unique: true });

export const Room = mongoose.model('Room', roomSchema);
