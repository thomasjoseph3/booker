import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import { errorHandler, notFoundHandler } from '../middleware/error.js';
import { createMcpRouter } from './routes.js';

/** The MCP server's own web app. `backendUrl` is the hotel API the booking tools call. */
export function createMcpApp({ backendUrl } = {}) {
  const app = express();
  app.use(helmet());
  app.use(cors({ origin: false })); // for programs and CLIs, not for browsers
  app.use(express.json({ limit: '1mb' }));
  app.get('/healthz', (req, res) => res.json({ ok: true, service: 'hotel-mcp' }));
  app.use('/mcp', createMcpRouter({ backendUrl }));
  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
