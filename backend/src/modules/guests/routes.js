import { Router } from 'express';
import { z } from 'zod';
import { validate } from '../../middleware/validate.js';
import { pageQuery } from '../../utils/pagination.js';
import * as service from './service.js';

const router = Router({ mergeParams: true });

router.get('/guests', validate(pageQuery.extend({ q: z.string().max(100).optional() }), 'query'), async (req, res) => {
  res.json(await service.listGuests(req.hotel, req.q.q, req.q));
});

router.get('/guests/:id', async (req, res) => {
  res.json(await service.guestProfile(req.hotel, req.params.id));
});

const guestChanges = z
  .object({ name: z.string().min(1).max(120), email: z.email(), notes: z.string().max(2000), vip: z.boolean() })
  .partial();

router.patch('/guests/:id', validate(guestChanges), async (req, res) => {
  res.json(await service.updateGuest(req.hotel, req.params.id, req.body));
});

export default router;
