import { Router } from 'express';
import { loadHotelParam, requireRole } from '../../middleware/auth.js';
import { validate, validatePatch } from '../../middleware/validate.js';
import { hotelSchema } from '../../validation.js';
import * as service from './service.js';

/** Hotel list, creation, settings and the agent API key. Mounted after requireAdmin. */
const router = Router();
router.param('hotelId', loadHotelParam); // loads req.hotel and checks the user's access to it

const managers = requireRole('super_admin', 'hotel_admin');

router.get('/hotels', async (req, res) => {
  res.json({ items: await service.listForUser(req.user) });
});

router.post('/hotels', requireRole('super_admin'), validate(hotelSchema), async (req, res) => {
  res.status(201).json(await service.createHotel(req.body));
});

router.get('/hotels/:hotelId', (req, res) => res.json(req.hotel));

router.patch('/hotels/:hotelId', managers, validatePatch(hotelSchema), async (req, res) => {
  res.json(await service.updateHotel(req.hotel, req.body, req.user));
});

// The plaintext key is only shown once.
router.post('/hotels/:hotelId/agent-key', managers, async (req, res) => {
  res.json({ apiKey: await service.rotateAgentKey(req.hotel), note: 'Store this key now; it cannot be shown again.' });
});

export default router;
