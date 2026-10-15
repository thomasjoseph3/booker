import bcrypt from 'bcryptjs';
import { Router } from 'express';
import { loadHotelParam, requireAdmin, requireRole, signToken } from '../../middleware/auth.js';
import { validate, validatePatch } from '../../middleware/validate.js';
import { AdminUser, Hotel } from '../../models/index.js';
import { badRequest, notFound, unauthorized } from '../../utils/errors.js';
import { generateApiKey, normalizePhone, sha256 } from '../../utils/misc.js';
import { hotelSchema, userSchema } from '../../validation.js';
import { z } from 'zod';
import hotelScoped from './hotelScoped.js';
import { rateLimit } from '../../middleware/rateLimit.js';

const router = Router();

// ---------- auth ----------

// 10 attempts per email+IP per 15 minutes
const loginLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 10, key: (req) => `${req.ip}:${String(req.body?.email || '').toLowerCase()}` });

router.post('/auth/login', loginLimiter, validate(z.object({ email: z.email(), password: z.string() })), async (req, res) => {
  const user = await AdminUser.findOne({ email: req.body.email.toLowerCase() }).select('+passwordHash');
  if (!user || !user.active || !(await bcrypt.compare(req.body.password, user.passwordHash))) throw unauthorized('Invalid email or password');
  user.lastLoginAt = new Date();
  await user.save();
  res.json({ token: signToken(user), user: { id: user._id, name: user.name, email: user.email, role: user.role, hotels: user.hotels } });
});

router.use(requireAdmin);

router.get('/auth/me', (req, res) => {
  const u = req.user;
  res.json({ id: u._id, name: u.name, email: u.email, role: u.role, hotels: u.hotels });
});

// ---------- users (platform admins) ----------

router.get('/users', requireRole('super_admin'), async (req, res) => {
  res.json({ items: await AdminUser.find().populate('hotels', 'name').sort({ createdAt: -1 }) });
});

router.post('/users', requireRole('super_admin'), validate(userSchema), async (req, res) => {
  const { password, ...rest } = req.body;
  const user = await AdminUser.create({ ...rest, passwordHash: await bcrypt.hash(password, 10) });
  res.status(201).json(await AdminUser.findById(user._id));
});

router.patch('/users/:id', requireRole('super_admin'), validatePatch(userSchema.extend({ active: z.boolean() })), async (req, res) => {
  const { password, ...rest } = req.body;
  const update = { ...rest };
  if (password) update.passwordHash = await bcrypt.hash(password, 10);
  const user = await AdminUser.findByIdAndUpdate(req.params.id, { $set: update }, { returnDocument: 'after', runValidators: true });
  if (!user) throw notFound('User');
  res.json(user);
});

// ---------- hotels ----------

router.get('/hotels', async (req, res) => {
  const filter = req.user.role === 'super_admin' ? {} : { _id: { $in: req.user.hotels } };
  res.json({ items: await Hotel.find(filter).sort({ name: 1 }) });
});

router.post('/hotels', requireRole('super_admin'), validate(hotelSchema), async (req, res) => {
  const body = { ...req.body, phoneNumbers: req.body.phoneNumbers.map(normalizePhone) };
  const hotel = await Hotel.create(body);
  res.status(201).json(hotel);
});

router.param('hotelId', loadHotelParam);

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

router.use('/hotels/:hotelId', hotelScoped);

export default router;
