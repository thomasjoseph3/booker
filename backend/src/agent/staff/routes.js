import { Router } from 'express';
import { z } from 'zod';
import { rateLimit } from '../../middleware/rateLimit.js';
import { validate } from '../../middleware/validate.js';
import { getChat, listChats } from '../../modules/conversations/service.js';
import { sendMessage, startChat } from './assistant.js';

/** Staff assistant API, under /api/admin/hotels/:hotelId. Any signed-in staff member of the property may use it. */
const router = Router({ mergeParams: true });

// The assistant calls a paid model, so cap how fast one person can send messages.
const perUser = rateLimit({ windowMs: 60 * 1000, max: 20, key: (req) => String(req.user._id) });

router.get('/assistant/chats', validate(z.object({ scope: z.enum(['mine', 'all']).default('mine') }), 'query'), async (req, res) => {
  res.json({ items: await listChats(req.hotel, req.user, { all: req.q.scope === 'all' }) });
});

router.post('/assistant/chats', async (req, res) => {
  res.status(201).json(await startChat(req.hotel, req.user));
});

router.get('/assistant/chats/:id', async (req, res) => {
  res.json(await getChat(req.hotel, req.user, req.params.id));
});

router.post(
  '/assistant/chats/:id/messages',
  perUser,
  validate(z.object({ text: z.string().trim().min(1).max(1500) })),
  async (req, res) => {
    res.json(await sendMessage(req.hotel, req.user, req.params.id, req.body.text));
  },
);

export default router;
