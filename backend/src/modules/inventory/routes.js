import { Router } from 'express';
import { z } from 'zod';
import { managers } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';
import { availabilitySchema, day, objectId } from '../../validation.js';
import { searchAvailability } from '../bookings/availability.js';
import * as service from './service.js';

const router = Router({ mergeParams: true });

router.get('/inventory', validate(z.object({ from: day, to: day }), 'query'), async (req, res) => {
  res.json(await service.inventoryGrid(req.hotel, req.q));
});

router.put('/inventory/stop-sell', managers, validate(z.object({ roomTypeId: objectId, from: day, to: day, closed: z.boolean() })), async (req, res) => {
  res.json({ ok: true, nights: await service.setStopSell(req.hotel, req.body) });
});

router.post('/availability', validate(availabilitySchema), async (req, res) => {
  res.json(await searchAvailability(req.hotel, req.body));
});

export default router;
