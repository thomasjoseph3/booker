import { Router } from 'express';
import { validate } from '../../middleware/validate.js';
import { Notification } from '../../models/index.js';
import { pageQuery, paginate } from '../../utils/pagination.js';

const router = Router({ mergeParams: true });

router.get('/notifications', validate(pageQuery, 'query'), async (req, res) => {
  res.json(await paginate(Notification, { hotel: req.hotel._id }, req.q, { populate: ['booking', 'code'] }));
});

export default router;
