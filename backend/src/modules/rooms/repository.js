import { Room, RoomType } from '../../models/index.js';

// ---------- room types (what is sold) ----------

export const listTypes = (hotelId) => RoomType.find({ hotel: hotelId }).sort({ basePrice: 1 });

export const listActiveTypes = (hotelId) => RoomType.find({ hotel: hotelId, active: true }).lean();

export const listActiveTypesByPrice = (hotelId) => RoomType.find({ hotel: hotelId, active: true }).sort({ basePrice: 1 }).lean();

export const findTypeById = (id) => RoomType.findById(id);

export const findActiveType = (hotelId, id) => RoomType.findOne({ _id: id, hotel: hotelId, active: true });

export const findType = (hotelId, id) => RoomType.findOne({ _id: id, hotel: hotelId });

export const typeExists = (hotelId, id) => RoomType.exists({ _id: id, hotel: hotelId });

export const createType = (hotelId, data) => RoomType.create({ ...data, hotel: hotelId });

export const updateType = (hotelId, id, changes) =>
  RoomType.findOneAndUpdate({ _id: id, hotel: hotelId }, { $set: changes }, { returnDocument: 'after', runValidators: true });

export const deactivateType = (hotelId, id) => RoomType.findOneAndUpdate({ _id: id, hotel: hotelId }, { $set: { active: false } }, { returnDocument: 'after' });

export const setTotalRooms = (typeId, total) => RoomType.updateOne({ _id: typeId }, { $set: { totalRooms: total } });

// ---------- physical rooms ----------

export const listRooms = (hotelId, { status, roomTypeId }) =>
  Room.find({ hotel: hotelId, ...(status ? { status } : {}), ...(roomTypeId ? { roomType: roomTypeId } : {}) })
    .populate('roomType', 'name code')
    .sort({ number: 1 });

export const createRoom = (hotelId, data) => Room.create({ ...data, hotel: hotelId });

export const findRoom = (hotelId, id) => Room.findOne({ _id: id, hotel: hotelId });

/** Deletes a room unless a guest is in it. */
export const deleteVacantRoom = (hotelId, id) => Room.findOneAndDelete({ _id: id, hotel: hotelId, status: { $ne: 'occupied' } });

/** Rooms that can be sold (everything except out-of-service) of a type. */
export const countSellable = (typeId) => Room.countDocuments({ roomType: typeId, status: { $ne: 'out_of_service' } });

export const findAvailableRooms = (hotelId, typeId, limit) =>
  Room.find({ hotel: hotelId, roomType: typeId, status: 'available' }).sort({ number: 1 }).limit(limit);

/** Puts a guest in the room, only if it is of this type and currently available. Returns false if not. */
export async function occupyIfAvailable(hotelId, typeId, roomId) {
  const result = await Room.updateOne({ _id: roomId, hotel: hotelId, roomType: typeId, status: 'available' }, { $set: { status: 'occupied' } });
  return result.modifiedCount === 1;
}

export const setStatus = (roomIds, status) => Room.updateMany({ _id: { $in: roomIds } }, { $set: { status } });
