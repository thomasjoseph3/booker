import { Router } from 'express';
import { z } from 'zod';
import { validate } from '../../middleware/validate.js';
import * as textAgent from './textAgent.js';

const router = Router({ mergeParams: true });

// ---------- browser test call (voice agent) ----------

router.post(
  '/voice/start',
  validate(z.object({ callerPhone: z.string().min(5), callerEmail: z.union([z.email(), z.literal('')]).optional() })),
  async (req, res) => {
    res.status(201).json(await textAgent.startCall(req.hotel, req.body));
  },
);
router.post('/voice/turn', validate(z.object({ callId: z.string(), text: z.string().trim().min(1).max(1000) })), async (req, res) => {
  res.json(await textAgent.agentTurn(req.hotel, req.body.callId, req.body.text));
});
router.post('/voice/end', validate(z.object({ callId: z.string() })), async (req, res) => {
  res.json(await textAgent.endCall(req.hotel, req.body.callId));
});

export default router;
