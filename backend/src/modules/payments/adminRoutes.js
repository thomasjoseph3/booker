import { Router } from 'express';
import { z } from 'zod';
import { validate } from '../../middleware/validate.js';
import { Payment } from '../../models/index.js';
import { conflict } from '../../utils/errors.js';
import { pageQuery, paginate } from '../../utils/pagination.js';

const router = Router({ mergeParams: true });

// ---------- payments ----------

router.get('/payments', validate(pageQuery.extend({ status: z.string().optional(), kind: z.enum(['charge', 'refund']).optional() }), 'query'), async (req, res) => {
  const filter = { hotel: req.hotel._id };
  if (req.q.status) filter.status = { $in: req.q.status.split(',') };
  if (req.q.kind) filter.kind = req.q.kind;
  res.json(await paginate(Payment, filter, req.q, { populate: ['booking', 'code guestName'] }));
});

// Mark a manual (offline) refund as handed back to the guest.
router.post('/payments/:id/mark-refunded', async (req, res) => {
  const p = await Payment.findOneAndUpdate(
    { _id: req.params.id, hotel: req.hotel._id, kind: 'refund', status: 'refund_pending' },
    { $set: { status: 'refunded', recordedBy: req.actor.label } },
    { returnDocument: 'after' },
  );
  if (!p) throw conflict('INVALID_STATE', 'Refund not found or not pending');
  res.json(p);
});

export default router;
