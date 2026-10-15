import { Router } from 'express';
import { managers } from '../../middleware/auth.js';
import { validate, validatePatch } from '../../middleware/validate.js';
import { roomSchema, roomTypeSchema } from '../../validation.js';
import * as service from './service.js';

const router = Router({ mergeParams: true });

// ---------- room types ----------

router.get('/room-types', async (req, res) => {
  res.json({ items: await service.listRoomTypes(req.hotel) });
});

router.post('/room-types', managers, validate(roomTypeSchema), async (req, res) => {
  res.status(201).json(await service.createRoomType(req.hotel, req.body));
});

router.patch('/room-types/:id', managers, validatePatch(roomTypeSchema), async (req, res) => {
  res.json(await service.updateRoomType(req.hotel, req.params.id, req.body));
});

router.delete('/room-types/:id', managers, async (req, res) => {
  await service.deactivateRoomType(req.hotel, req.params.id);
  res.json({ ok: true, note: 'Room type deactivated; existing bookings are unaffected.' });
});

// ---------- physical rooms ----------

router.get('/rooms', async (req, res) => {
  res.json({ items: await service.listRoomsWithStays(req.hotel, req.query) });
});

router.post('/rooms', managers, validate(roomSchema), async (req, res) => {
  res.status(201).json(await service.createRoom(req.hotel, req.body));
});

router.patch('/rooms/:id', validatePatch(roomSchema), async (req, res) => {
  res.json(await service.updateRoom(req.hotel, req.user, req.params.id, req.body));
});

router.delete('/rooms/:id', managers, async (req, res) => {
  await service.deleteRoom(req.hotel, req.params.id);
  res.json({ ok: true });
});

export default router;
