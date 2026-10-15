import { Router } from 'express';
import { z } from 'zod';
import { managers } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';
import { Inventory, RoomType } from '../../models/index.js';
import { setStopSell } from './service.js';
import * as svc from '../bookings/service.js';
import { addDays, nightsBetween } from '../../utils/dates.js';
import { badRequest, notFound } from '../../utils/errors.js';
import { availabilitySchema, day, objectId } from '../../validation.js';

const router = Router({ mergeParams: true });

// ---------- inventory ----------

router.get('/inventory', validate(z.object({ from: day, to: day }), 'query'), async (req, res) => {
  const { from, to } = req.q;
  const dates = nightsBetween(from, addDays(to, 1));
  if (dates.length > 92) throw badRequest('Range is limited to 92 days');
  const roomTypes = await RoomType.find({ hotel: req.hotel._id, active: true }).lean();
  const rows = await Inventory.find({ hotel: req.hotel._id, date: { $in: dates } }).lean();
  const byKey = new Map(rows.map((r) => [`${r.roomType}:${r.date}`, r]));
  res.json({
    dates,
    roomTypes: roomTypes.map((rt) => ({
      roomTypeId: rt._id,
      name: rt.name,
      totalRooms: rt.totalRooms,
      days: dates.map((date) => {
        const r = byKey.get(`${rt._id}:${date}`);
        const booked = r?.booked || 0;
        return { date, booked, available: r?.closed ? 0 : Math.max(0, rt.totalRooms - booked), closed: Boolean(r?.closed) };
      }),
    })),
  });
});

router.put('/inventory/stop-sell', managers, validate(z.object({ roomTypeId: objectId, from: day, to: day, closed: z.boolean() })), async (req, res) => {
  const rt = await RoomType.findOne({ _id: req.body.roomTypeId, hotel: req.hotel._id });
  if (!rt) throw notFound('Room type');
  if (req.body.to < req.body.from) throw badRequest('`to` must be on or after `from`');
  const nights = await setStopSell(rt, req.body.from, req.body.to, req.body.closed);
  res.json({ ok: true, nights });
});

router.post('/availability', validate(availabilitySchema), async (req, res) => {
  res.json(await svc.searchAvailability(req.hotel, req.body));
});

export default router;
