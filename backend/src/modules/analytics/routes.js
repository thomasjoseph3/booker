import { Router } from 'express';
import { z } from 'zod';
import { validate } from '../../middleware/validate.js';
import * as service from './service.js';

const router = Router({ mergeParams: true });

router.get('/dashboard', async (req, res) => {
  res.json(await service.dashboard(req.hotel));
});

router.get('/analytics', validate(z.object({ days: z.coerce.number().int().min(1).max(365).default(30) }), 'query'), async (req, res) => {
  res.json(await service.analytics(req.hotel, req.q.days));
});

export default router;
