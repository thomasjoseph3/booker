import { Router } from 'express';
import { validate } from '../../middleware/validate.js';
import { pageQuery } from '../../utils/pagination.js';
import * as repo from './repository.js';

const router = Router({ mergeParams: true });

router.get('/notifications', validate(pageQuery, 'query'), async (req, res) => {
  res.json(await repo.list(req.hotel._id, req.q));
});

export default router;
