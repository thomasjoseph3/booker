import { Inventory } from '../../models/index.js';

/** One row per room type and night (`booked` rooms, `closed` for stop-sell). */

export async function ensureRows(roomType, nights) {
  await Inventory.bulkWrite(
    nights.map((date) => ({
      updateOne: {
        filter: { roomType: roomType._id, date },
        update: { $setOnInsert: { hotel: roomType.hotel, roomType: roomType._id, date, booked: 0, closed: false } },
        upsert: true,
      },
    })),
    { ordered: false },
  );
}

/** Takes `qty` rooms for one night, only if the night is open and has capacity. Returns false when full. */
export async function takeNight(roomType, date, qty) {
  const result = await Inventory.updateOne(
    { roomType: roomType._id, date, closed: false, booked: { $lte: roomType.totalRooms - qty } },
    { $inc: { booked: qty } },
  );
  return result.modifiedCount === 1;
}

/** Gives `qty` rooms back for the nights. The `booked >= qty` guard keeps a counter from ever going negative. */
export async function releaseNights(roomTypeId, nights, qty) {
  if (!nights.length) return;
  await Inventory.updateMany({ roomType: roomTypeId, date: { $in: nights }, booked: { $gte: qty } }, { $inc: { booked: -qty } });
}

export const rowsForRoomTypes = (roomTypeIds, nights) => Inventory.find({ roomType: { $in: roomTypeIds }, date: { $in: nights } }).lean();

export const rowsForHotel = (hotelId, nights) => Inventory.find({ hotel: hotelId, date: { $in: nights } }).lean();

export const setClosed = (roomTypeId, nights, closed) =>
  Inventory.updateMany({ roomType: roomTypeId, date: { $in: nights } }, { $set: { closed } });
