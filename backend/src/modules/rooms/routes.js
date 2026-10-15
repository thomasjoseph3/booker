import { Router } from 'express';
import { managers } from '../../middleware/auth.js';
import { validate, validatePatch } from '../../middleware/validate.js';
import { Booking, Room, RoomType } from '../../models/index.js';
import { badRequest, notFound } from '../../utils/errors.js';
import { roomSchema, roomTypeSchema } from '../../validation.js';

const router = Router({ mergeParams: true });

// ---------- room types ----------

router.get('/room-types', async (req, res) => {
  res.json({ items: await RoomType.find({ hotel: req.hotel._id }).sort({ basePrice: 1 }) });
});

router.post('/room-types', managers, validate(roomTypeSchema), async (req, res) => {
  res.status(201).json(await RoomType.create({ ...req.body, hotel: req.hotel._id }));
});

router.patch('/room-types/:id', managers, validatePatch(roomTypeSchema), async (req, res) => {
  const rt = await RoomType.findOneAndUpdate({ _id: req.params.id, hotel: req.hotel._id }, { $set: req.body }, { returnDocument: 'after', runValidators: true });
  if (!rt) throw notFound('Room type');
  res.json(rt);
});

router.delete('/room-types/:id', managers, async (req, res) => {
  const rt = await RoomType.findOneAndUpdate({ _id: req.params.id, hotel: req.hotel._id }, { $set: { active: false } }, { returnDocument: 'after' });
  if (!rt) throw notFound('Room type');
  res.json({ ok: true, note: 'Room type deactivated; existing bookings are unaffected.' });
});

// ---------- physical rooms ----------

async function syncTotalRooms(roomTypeId) {
  const n = await Room.countDocuments({ roomType: roomTypeId, status: { $ne: 'out_of_service' } });
  await RoomType.updateOne({ _id: roomTypeId }, { $set: { totalRooms: n } });
}

router.get('/rooms', async (req, res) => {
  const filter = { hotel: req.hotel._id };
  if (req.query.status) filter.status = req.query.status;
  if (req.query.roomTypeId) filter.roomType = req.query.roomTypeId;
  const rooms = await Room.find(filter).populate('roomType', 'name code').sort({ number: 1 });
  const ids = rooms.map((r) => r._id);
  const fields = 'code guestName checkIn checkOut checkedInAt checkedOutAt assignedRooms adults children';
  const [inHouse, departed] = await Promise.all([
    Booking.find({ hotel: req.hotel._id, status: 'checked_in', assignedRooms: { $in: ids } }).select(fields).lean(),
    Booking.find({ hotel: req.hotel._id, status: 'checked_out', assignedRooms: { $in: ids }, checkedOutAt: { $ne: null } })
      .sort({ checkedOutAt: -1 }).limit(500).select(fields).lean(),
  ]);
  const current = new Map();
  for (const b of inHouse) for (const r of b.assignedRooms) current.set(String(r), b);
  const last = new Map();
  for (const b of departed) for (const r of b.assignedRooms) if (!last.has(String(r))) last.set(String(r), b);
  const brief = (b) => b && { code: b.code, guestName: b.guestName, checkIn: b.checkIn, checkOut: b.checkOut, checkedInAt: b.checkedInAt, checkedOutAt: b.checkedOutAt, adults: b.adults, children: b.children };
  res.json({
    items: rooms.map((r) => ({ ...r.toObject(), currentStay: brief(current.get(String(r._id))) ?? null, lastStay: brief(last.get(String(r._id))) ?? null })),
  });
});

router.post('/rooms', managers, validate(roomSchema), async (req, res) => {
  const { roomTypeId, ...rest } = req.body;
  if (!(await RoomType.exists({ _id: roomTypeId, hotel: req.hotel._id }))) throw notFound('Room type');
  const room = await Room.create({ ...rest, roomType: roomTypeId, hotel: req.hotel._id });
  await syncTotalRooms(roomTypeId);
  res.status(201).json(room);
});

// Front desk can update room status (cleaning -> available); managers can change everything.
router.patch('/rooms/:id', validatePatch(roomSchema), async (req, res) => {
  const { roomTypeId, ...rest } = req.body;
  if ((roomTypeId || rest.number) && !['super_admin', 'hotel_admin'].includes(req.user.role)) throw badRequest('Only managers can change room number or type');
  const room = await Room.findOne({ _id: req.params.id, hotel: req.hotel._id });
  if (!room) throw notFound('Room');
  const oldType = room.roomType;
  if (roomTypeId) {
    if (!(await RoomType.exists({ _id: roomTypeId, hotel: req.hotel._id }))) throw notFound('Room type');
    room.roomType = roomTypeId;
  }
  Object.assign(room, rest);
  await room.save();
  await syncTotalRooms(room.roomType);
  if (String(oldType) !== String(room.roomType)) await syncTotalRooms(oldType);
  res.json(room);
});

router.delete('/rooms/:id', managers, async (req, res) => {
  const room = await Room.findOneAndDelete({ _id: req.params.id, hotel: req.hotel._id, status: { $ne: 'occupied' } });
  if (!room) throw notFound('Room (or it is occupied)');
  await syncTotalRooms(room.roomType);
  res.json({ ok: true });
});

export default router;
