import { Router } from 'express';
import { z } from 'zod';
import { validate } from '../../middleware/validate.js';
import { Callback, CallLog } from '../../models/index.js';
import { notFound } from '../../utils/errors.js';
import { pageQuery, paginate } from '../../utils/pagination.js';

const router = Router({ mergeParams: true });

// ---------- calls, callbacks, notifications ----------

router.get('/calls', validate(pageQuery.extend({ outcome: z.string().optional() }), 'query'), async (req, res) => {
  const filter = { hotel: req.hotel._id };
  if (req.q.outcome) filter.outcome = req.q.outcome;
  res.json(await paginate(CallLog, filter, req.q, { select: '-transcript', populate: ['bookings', 'code status'] }));
});

router.get('/calls/:id', async (req, res) => {
  const call = await CallLog.findOne({ _id: req.params.id, hotel: req.hotel._id }).populate('bookings', 'code status checkIn checkOut').populate('guest');
  if (!call) throw notFound('Call');
  res.json(call);
});

router.get('/callbacks', validate(pageQuery.extend({ status: z.string().optional() }), 'query'), async (req, res) => {
  const filter = { hotel: req.hotel._id };
  if (req.q.status) filter.status = { $in: req.q.status.split(',') };
  res.json(await paginate(Callback, filter, req.q, { populate: ['booking', 'code status'] }));
});

router.patch(
  '/callbacks/:id',
  validate(z.object({ status: z.enum(['open', 'in_progress', 'done']), assignedTo: z.string().max(120), notes: z.string().max(2000), priority: z.enum(['low', 'normal', 'high']) }).partial()),
  async (req, res) => {
    const cb = await Callback.findOneAndUpdate({ _id: req.params.id, hotel: req.hotel._id }, { $set: req.body }, { returnDocument: 'after' });
    if (!cb) throw notFound('Callback');
    res.json(cb);
  },
);

export default router;
