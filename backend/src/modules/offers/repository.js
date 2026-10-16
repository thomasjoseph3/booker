import { Offer } from '../../models/index.js';

export const list = (hotelId) => Offer.find({ hotel: hotelId }).sort({ active: -1, createdAt: -1 });
export const listActive = (hotelId, today) =>
  Offer.find({ hotel: hotelId, active: true, $or: [{ bookUntil: null }, { bookUntil: { $exists: false } }, { bookUntil: { $gte: today } }] }).lean();
export const create = (hotelId, data) => Offer.create({ ...data, hotel: hotelId });
export const update = (hotelId, id, changes) =>
  Offer.findOneAndUpdate({ _id: id, hotel: hotelId }, { $set: changes }, { returnDocument: 'after', runValidators: true });
export const remove = (hotelId, id) => Offer.findOneAndDelete({ _id: id, hotel: hotelId });
