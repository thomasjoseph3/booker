import mongoose from 'mongoose';

const { Schema } = mongoose;

const adminUserSchema = new Schema(
  {
    name: { type: String, required: true },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    passwordHash: { type: String, required: true, select: false },
    // super_admin: whole platform; hotel_admin: manage assigned hotels; staff: front-desk operations
    role: { type: String, enum: ['super_admin', 'hotel_admin', 'staff'], default: 'staff' },
    hotels: [{ type: Schema.Types.ObjectId, ref: 'Hotel' }],
    active: { type: Boolean, default: true },
    lastLoginAt: Date,
  },
  { timestamps: true },
);

export const AdminUser = mongoose.model('AdminUser', adminUserSchema);
