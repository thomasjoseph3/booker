import { Router } from 'express';
import { loadHotelParam, requireRole } from '../../middleware/auth.js';
import { validate, validatePatch } from '../../middleware/validate.js';
import { Hotel } from '../../models/index.js';
import { badRequest } from '../../utils/errors.js';
import { generateApiKey, normalizePhone, sha256 } from '../../utils/misc.js';
import { hotelSchema } from '../../validation.js';

/** Hotel list, creation, settings and the agent API key. Mounted after requireAdmin. */
const router = Router();
router.param('hotelId', loadHotelParam); // loads req.hotel and checks the user's access to it

router.get('/hotels', async (req, res) => {
  const filter = req.user.role === 'super_admin' ? {} : { _id: { $in: req.user.hotels } };
  res.json({ items: await Hotel.find(filter).sort({ name: 1 }) });
});

router.post('/hotels', requireRole('super_admin'), validate(hotelSchema), async (req, res) => {
  const body = { ...req.body, phoneNumbers: req.body.phoneNumbers.map(normalizePhone) };
  const hotel = await Hotel.create(body);
  res.status(201).json(hotel);
});

router.get('/hotels/:hotelId', (req, res) => res.json(req.hotel));

router.patch('/hotels/:hotelId', requireRole('super_admin', 'hotel_admin'), validatePatch(hotelSchema), async (req, res) => {
  const hotel = req.hotel;
  for (const [key, value] of Object.entries(req.body)) {
    if (key === 'slug' && req.user.role !== 'super_admin') throw badRequest('Only platform admins can change the slug');
    const current = hotel.get(key);
    const isNested = value && typeof value === 'object' && !Array.isArray(value) && current && typeof current === 'object' && !Array.isArray(current);
    // Merge one level deep so { payment: { advancePercent: 40 } } doesn't wipe other payment settings
    hotel.set(key, isNested ? { ...(current.toObject?.() ?? current), ...value } : value);
  }
  if (req.body.phoneNumbers) hotel.phoneNumbers = req.body.phoneNumbers.map(normalizePhone);
  await hotel.save();
  res.json(hotel);
});

// Rotate the hotel's agent API key; the plaintext key is only shown once.
router.post('/hotels/:hotelId/agent-key', requireRole('super_admin', 'hotel_admin'), async (req, res) => {
  const key = generateApiKey(`hk_${req.hotel.slug.replace(/-/g, '').slice(0, 8)}`);
  await Hotel.updateOne({ _id: req.hotel._id }, { $set: { 'agent.apiKeyHash': sha256(key), 'agent.apiKeyPreview': `${key.slice(0, 14)}…${key.slice(-4)}` } });
  res.json({ apiKey: key, note: 'Store this key now; it cannot be shown again.' });
});

export default router;
