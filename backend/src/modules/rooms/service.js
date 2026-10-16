import { badRequest, notFound } from '../../utils/errors.js';
import * as bookings from '../bookings/repository.js';
import { todayIn } from '../../utils/dates.js';
import * as repo from './repository.js';

const MANAGER_ROLES = ['super_admin', 'hotel_admin'];

/** Keeps a room type's sellable count equal to its physical rooms that are not out of service. */
async function syncTotalRooms(typeId) {
  await repo.setTotalRooms(typeId, await repo.countSellable(typeId));
}

const stayBrief = (b) =>
  b && {
    code: b.code,
    guestName: b.guestName,
    checkIn: b.checkIn,
    checkOut: b.checkOut,
    checkedInAt: b.checkedInAt,
    checkedOutAt: b.checkedOutAt,
    adults: b.adults,
    children: b.children,
  };

/** Rooms with the guest currently in them and the last guest who left (housekeeping view). */
export async function listRoomsWithStays(hotel, filters) {
  const rooms = await repo.listRooms(hotel._id, filters);
  const { inHouse, departed } = await bookings.staysForRooms(
    hotel._id,
    rooms.map((r) => r._id),
  );
  const current = new Map();
  for (const b of inHouse) for (const r of b.assignedRooms) current.set(String(r), b);
  const last = new Map();
  for (const b of departed) for (const r of b.assignedRooms) if (!last.has(String(r))) last.set(String(r), b);

  // Guests with a confirmed booking for today who have not checked in: show their rooms as reserved.
  // Rooms are only really assigned at check-in, so mark the lowest-numbered free rooms of the type (what check-in picks).
  const reserved = new Map();
  const arrivals = await bookings.awaitingArrival(hotel._id, todayIn(hotel.timezone));
  const taken = new Set();
  for (const b of arrivals) {
    const free = rooms
      .filter((r) => String(r.roomType?._id ?? r.roomType) === String(b.roomType) && ['available', 'cleaning'].includes(r.status) && !current.has(String(r._id)) && !taken.has(String(r._id)))
      .sort((a, c) => (a.status === c.status ? 0 : a.status === 'available' ? -1 : 1));
    for (const r of free.slice(0, b.roomsCount ?? 1)) {
      taken.add(String(r._id));
      reserved.set(String(r._id), stayBrief(b));
    }
  }

  return rooms.map((r) => ({
    ...r.toObject(),
    currentStay: stayBrief(current.get(String(r._id))) ?? null,
    lastStay: stayBrief(last.get(String(r._id))) ?? null,
    reservedStay: reserved.get(String(r._id)) ?? null,
  }));
}

export async function createRoom(hotel, { roomTypeId, ...data }) {
  if (!(await repo.typeExists(hotel._id, roomTypeId))) throw notFound('Room type');
  const room = await repo.createRoom(hotel._id, { ...data, roomType: roomTypeId });
  await syncTotalRooms(roomTypeId);
  return room;
}

/** Front desk may update a room's status (cleaning to available); only managers may change its number or type. */
export async function updateRoom(hotel, user, id, { roomTypeId, ...changes }) {
  if ((roomTypeId || changes.number) && !MANAGER_ROLES.includes(user.role))
    throw badRequest('Only managers can change room number or type');
  const room = await repo.findRoom(hotel._id, id);
  if (!room) throw notFound('Room');
  const oldType = room.roomType;
  if (roomTypeId) {
    if (!(await repo.typeExists(hotel._id, roomTypeId))) throw notFound('Room type');
    room.roomType = roomTypeId;
  }
  Object.assign(room, changes);
  await room.save();
  await syncTotalRooms(room.roomType);
  if (String(oldType) !== String(room.roomType)) await syncTotalRooms(oldType);
  return room;
}

export async function deleteRoom(hotel, id) {
  const room = await repo.deleteVacantRoom(hotel._id, id);
  if (!room) throw notFound('Room (or it is occupied)');
  await syncTotalRooms(room.roomType);
}

export async function updateRoomType(hotel, id, changes) {
  const type = await repo.updateType(hotel._id, id, changes);
  if (!type) throw notFound('Room type');
  return type;
}

export async function deactivateRoomType(hotel, id) {
  if (!(await repo.deactivateType(hotel._id, id))) throw notFound('Room type');
}

export const listRoomTypes = (hotel) => repo.listTypes(hotel._id);
export const createRoomType = (hotel, data) => repo.createType(hotel._id, data);

/** Housekeeping takes a day at most: rooms left on "cleaning" longer than that are ready again. Returns how many. */
export const releaseStaleCleaning = (maxHours, now = new Date()) =>
  repo.releaseStaleCleaning(new Date(now.getTime() - maxHours * 3600 * 1000));
