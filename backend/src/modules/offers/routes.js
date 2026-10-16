import { Router } from 'express';
import { managers } from '../../middleware/auth.js';
import { validate, validatePatch } from '../../middleware/validate.js';
import { notFound } from '../../utils/errors.js';
import { offerSchema } from '../../validation.js';
import * as repo from './repository.js';

const router = Router({ mergeParams: true });

router.get('/offers', async (req, res) => res.json({ items: await repo.list(req.hotel._id) }));

router.post('/offers', managers, validate(offerSchema), async (req, res) => {
  res.status(201).json(await repo.create(req.hotel._id, req.body));
});

router.patch('/offers/:id', managers, validatePatch(offerSchema), async (req, res) => {
  const offer = await repo.update(req.hotel._id, req.params.id, req.body);
  if (!offer) throw notFound('Offer');
  res.json(offer);
});

router.delete('/offers/:id', managers, async (req, res) => {
  if (!(await repo.remove(req.hotel._id, req.params.id))) throw notFound('Offer');
  res.json({ ok: true });
});

export default router;
