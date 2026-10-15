import { Router } from 'express';
import { propertyProfile } from './service.js';

/** Unauthenticated, guest-facing property info for the public website. */
const router = Router();

router.get('/hotels/:slug', async (req, res) => {
  res.json(await propertyProfile(req.params.slug));
});

export default router;
