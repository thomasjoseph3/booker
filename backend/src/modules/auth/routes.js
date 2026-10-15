import { Router } from 'express';
import { z } from 'zod';
import { requireRole } from '../../middleware/auth.js';
import { rateLimit } from '../../middleware/rateLimit.js';
import { validate, validatePatch } from '../../middleware/validate.js';
import { userSchema } from '../../validation.js';
import * as service from './service.js';

/** Login: the only admin endpoint that needs no token. */
export const loginRouter = Router();

// 10 attempts per email+IP per 15 minutes
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  key: (req) => `${req.ip}:${String(req.body?.email || '').toLowerCase()}`,
});

loginRouter.post('/auth/login', loginLimiter, validate(z.object({ email: z.email(), password: z.string() })), async (req, res) => {
  res.json(await service.login(req.body.email, req.body.password));
});

/** The signed-in user and platform-admin user management. Mounted after requireAdmin. */
export const accountRouter = Router();
const platformAdmins = requireRole('super_admin');

accountRouter.get('/auth/me', (req, res) => res.json(service.describeUser(req.user)));

accountRouter.get('/users', platformAdmins, async (req, res) => {
  res.json({ items: await service.listUsers() });
});

accountRouter.post('/users', platformAdmins, validate(userSchema), async (req, res) => {
  res.status(201).json(await service.createUser(req.body));
});

accountRouter.patch('/users/:id', platformAdmins, validatePatch(userSchema.extend({ active: z.boolean() })), async (req, res) => {
  res.json(await service.updateUser(req.params.id, req.body));
});
