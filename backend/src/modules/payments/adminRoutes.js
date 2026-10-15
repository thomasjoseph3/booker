import { Router } from 'express';
import { z } from 'zod';
import { validate } from '../../middleware/validate.js';
import { conflict } from '../../utils/errors.js';
import { pageQuery } from '../../utils/pagination.js';
import * as service from './service.js';

const router = Router({ mergeParams: true });

const paymentFilters = pageQuery.extend({ status: z.string().optional(), kind: z.enum(['charge', 'refund']).optional() });

router.get('/payments', validate(paymentFilters, 'query'), async (req, res) => {
  res.json(await service.listPayments(req.hotel._id, req.q, req.q));
});

// Mark a manual (offline) refund as handed back to the guest.
router.post('/payments/:id/mark-refunded', async (req, res) => {
  const payment = await service.markRefundDelivered(req.hotel._id, req.params.id, req.actor.label);
  if (!payment) throw conflict('INVALID_STATE', 'Refund not found or not pending');
  res.json(payment);
});

export default router;
