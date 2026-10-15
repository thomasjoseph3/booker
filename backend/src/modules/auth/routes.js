import bcrypt from 'bcryptjs';
import { Router } from 'express';
import { z } from 'zod';
import { requireRole, signToken } from '../../middleware/auth.js';
import { rateLimit } from '../../middleware/rateLimit.js';
import { validate, validatePatch } from '../../middleware/validate.js';
import { AdminUser } from '../../models/index.js';
import { notFound, unauthorized } from '../../utils/errors.js';
import { userSchema } from '../../validation.js';

/** Login: the only admin endpoint that needs no token. */
export const loginRouter = Router();

// 10 attempts per email+IP per 15 minutes
const loginLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 10, key: (req) => `${req.ip}:${String(req.body?.email || '').toLowerCase()}` });

loginRouter.post('/auth/login', loginLimiter, validate(z.object({ email: z.email(), password: z.string() })), async (req, res) => {
  const user = await AdminUser.findOne({ email: req.body.email.toLowerCase() }).select('+passwordHash');
  if (!user || !user.active || !(await bcrypt.compare(req.body.password, user.passwordHash))) throw unauthorized('Invalid email or password');
  user.lastLoginAt = new Date();
  await user.save();
  res.json({ token: signToken(user), user: { id: user._id, name: user.name, email: user.email, role: user.role, hotels: user.hotels } });
});

/** The signed-in user and platform-admin user management. Mounted after requireAdmin. */
export const accountRouter = Router();

accountRouter.get('/auth/me', (req, res) => {
  const u = req.user;
  res.json({ id: u._id, name: u.name, email: u.email, role: u.role, hotels: u.hotels });
});

// ---------- users (platform admins) ----------

accountRouter.get('/users', requireRole('super_admin'), async (req, res) => {
  res.json({ items: await AdminUser.find().populate('hotels', 'name').sort({ createdAt: -1 }) });
});

accountRouter.post('/users', requireRole('super_admin'), validate(userSchema), async (req, res) => {
  const { password, ...rest } = req.body;
  const user = await AdminUser.create({ ...rest, passwordHash: await bcrypt.hash(password, 10) });
  res.status(201).json(await AdminUser.findById(user._id));
});

accountRouter.patch('/users/:id', requireRole('super_admin'), validatePatch(userSchema.extend({ active: z.boolean() })), async (req, res) => {
  const { password, ...rest } = req.body;
  const update = { ...rest };
  if (password) update.passwordHash = await bcrypt.hash(password, 10);
  const user = await AdminUser.findByIdAndUpdate(req.params.id, { $set: update }, { returnDocument: 'after', runValidators: true });
  if (!user) throw notFound('User');
  res.json(user);
});
