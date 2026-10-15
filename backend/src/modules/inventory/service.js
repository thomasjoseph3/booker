import { addDays, nightsBetween } from '../../utils/dates.js';
import { badRequest, conflict, notFound } from '../../utils/errors.js';
import * as rooms from '../rooms/repository.js';
import * as repo from './repository.js';

/**
 * Atomically takes `qty` rooms of `roomType` for every night in [checkIn, checkOut).
 * Each night is a conditional increment; if any night is full, the nights already taken are rolled back.
 */
export async function reserveInventory(roomType, checkIn, checkOut, qty) {
  const nights = nightsBetween(checkIn, checkOut);
  await repo.ensureRows(roomType, nights);
  const taken = [];
  for (const date of nights) {
    if (!(await repo.takeNight(roomType, date, qty))) {
      await repo.releaseNights(roomType._id, taken, qty);
      throw conflict('NO_AVAILABILITY', `${roomType.name} is not available on ${date}`, { date, roomType: roomType.name });
    }
    taken.push(date);
  }
}

export const releaseInventory = (roomTypeId, checkIn, checkOut, qty) => repo.releaseNights(roomTypeId, nightsBetween(checkIn, checkOut), qty);

/** Rooms still sellable per room type for the whole stay. */
export async function availabilityFor(roomTypes, checkIn, checkOut) {
  const nights = nightsBetween(checkIn, checkOut);
  const rows = await repo.rowsForRoomTypes(roomTypes.map((r) => r._id), nights);
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

/** Opens or closes sale of a room type for the nights `from`..`to` inclusive. */
export async function setStopSell(hotel, { roomTypeId, from, to, closed }) {
  const roomType = await rooms.findType(hotel._id, roomTypeId);
  if (!roomType) throw notFound('Room type');
  if (to < from) throw badRequest('`to` must be on or after `from`');
  const nights = nightsBetween(from, addDays(to, 1));
  await repo.ensureRows(roomType, nights);
  await repo.setClosed(roomType._id, nights, closed);
  return nights.length;
}

/** Day-by-day sold / available / closed grid for every active room type. */
export async function inventoryGrid(hotel, { from, to }) {
  const dates = nightsBetween(from, addDays(to, 1));
  if (dates.length > 92) throw badRequest('Range is limited to 92 days');
  const [roomTypes, rows] = await Promise.all([rooms.listActiveTypes(hotel._id), repo.rowsForHotel(hotel._id, dates)]);
  const byKey = new Map(rows.map((r) => [`${r.roomType}:${r.date}`, r]));
  return {
    dates,
    roomTypes: roomTypes.map((rt) => ({
      roomTypeId: rt._id,
      name: rt.name,
      totalRooms: rt.totalRooms,
      days: dates.map((date) => {
        const row = byKey.get(`${rt._id}:${date}`);
        const booked = row?.booked || 0;
        return { date, booked, available: row?.closed ? 0 : Math.max(0, rt.totalRooms - booked), closed: Boolean(row?.closed) };
      }),
    })),
  };
}
