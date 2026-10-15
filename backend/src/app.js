import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import morgan from 'morgan';
import { config } from './config.js';
import { errorHandler, notFoundHandler } from './middleware/error.js';
import adminRouter from './routes/admin/index.js';
import agentRouter from './routes/agent.js';
import publicRouter from './routes/public.js';
import { payPagesRouter, webhookRouter } from './routes/payments.js';

export function createApp() {
  const app = express();
  app.set('trust proxy', 1);
  app.use(helmet({ contentSecurityPolicy: false }));
  app.use(cors());
  if (process.env.NODE_ENV !== 'test') app.use(morgan('dev'));

  app.use('/api/payments/webhook', webhookRouter); // raw body — before express.json
  app.use(express.json({ limit: '1mb' }));
  app.use(express.urlencoded({ extended: false }));

  app.get('/health', (req, res) => res.json({ ok: true }));
  app.use('/api/agent', agentRouter);
  app.use('/api/public', publicRouter);
  app.use('/api/admin', adminRouter);
  app.use('/pay', payPagesRouter);
  // The admin dashboard is the separate Next.js app in ../admin
  app.get(['/', '/admin'], (req, res) => res.redirect(config.adminUrl));

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
