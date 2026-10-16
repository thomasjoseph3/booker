import { Router } from 'express';
import { z } from 'zod';
import { validate } from '../../middleware/validate.js';
import { notFound } from '../../utils/errors.js';
import { pageQuery } from '../../utils/pagination.js';
import * as service from './service.js';

const router = Router({ mergeParams: true });

router.get('/calls', validate(pageQuery.extend({ outcome: z.string().optional() }), 'query'), async (req, res) => {
  res.json(await service.listCalls(req.hotel._id, req.q, req.q));
});

router.get('/calls/:id', async (req, res) => {
  const call = await service.findCall(req.hotel._id, req.params.id);
  if (!call) throw notFound('Call');
  res.json(call);
});

router.get('/callbacks', validate(pageQuery.extend({ status: z.string().optional(), priority: z.string().optional(), type: z.string().optional() }), 'query'), async (req, res) => {
  res.json(await service.listCallbacks(req.hotel._id, req.q, req.q));
});

const callbackChanges = z
  .object({
    status: z.enum(['open', 'in_progress', 'done']),
    assignedTo: z.string().max(120),
    notes: z.string().max(2000),
    priority: z.enum(['low', 'normal', 'high']),
    type: z.enum(['callback', 'question', 'complaint', 'booking_help', 'group_booking', 'payment', 'special_request', 'system']),
  })
  .partial();

router.patch('/callbacks/:id', validate(callbackChanges), async (req, res) => {
  const callback = await service.updateCallback(req.hotel._id, req.params.id, req.body);
  if (!callback) throw notFound('Callback');
  res.json(callback);
});

export default router;
