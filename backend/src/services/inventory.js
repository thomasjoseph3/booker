import { Inventory } from '../models/index.js';
import { conflict } from '../utils/errors.js';
import { addDays, nightsBetween } from '../utils/dates.js';

async function ensureRows(roomType, nights) {
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

async function release(roomTypeId, nights, qty) {
  if (!nights.length) return;
  await Inventory.updateMany({ roomType: roomTypeId, date: { $in: nights }, booked: { $gte: qty } }, { $inc: { booked: -qty } });
}

/**
 * Atomically takes `qty` rooms of `roomType` for every night in [checkIn, checkOut).
 * Each night is a conditional increment; if any night is full, the nights already taken are rolled back.
 */
export async function reserveInventory(roomType, checkIn, checkOut, qty) {
  const nights = nightsBetween(checkIn, checkOut);
  await ensureRows(roomType, nights);
  const taken = [];
  for (const date of nights) {
    const res = await Inventory.updateOne(
      { roomType: roomType._id, date, closed: false, booked: { $lte: roomType.totalRooms - qty } },
      { $inc: { booked: qty } },
    );
    if (res.modifiedCount !== 1) {
      await release(roomType._id, taken, qty);
      throw conflict('NO_AVAILABILITY', `${roomType.name} is not available on ${date}`, { date, roomType: roomType.name });
    }
    taken.push(date);
  }
}

export async function releaseInventory(roomTypeId, checkIn, checkOut, qty) {
  await release(roomTypeId, nightsBetween(checkIn, checkOut), qty);
}

/** Rooms still sellable per room type for the whole stay. */
export async function availabilityFor(roomTypes, checkIn, checkOut) {
  const nights = nightsBetween(checkIn, checkOut);
  const rows = await Inventory.find({ roomType: { $in: roomTypes.map((r) => r._id) }, date: { $in: nights } }).lean();
  const byKey = new Map(rows.map((r) => [`${r.roomType}:${r.date}`, r]));
  const result = new Map();
  for (const rt of roomTypes) {
    let min = rt.totalRooms;
    for (const date of nights) {
      const row = byKey.get(`${rt._id}:${date}`);
      const free = row?.closed ? 0 : rt.totalRooms - (row?.booked || 0);
      min = Math.min(min, free);
    }
    result.set(String(rt._id), Math.max(0, min));
  }
  return result;
}

/** Opens/closes sale for the nights `from`..`to` inclusive. */
export async function setStopSell(roomType, from, to, closed) {
  const nights = nightsBetween(from, addDays(to, 1));
  await ensureRows(roomType, nights);
  await Inventory.updateMany({ roomType: roomType._id, date: { $in: nights } }, { $set: { closed } });
  return nights.length;
}
