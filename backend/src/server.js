import { config } from './config.js';
import { connectDb } from './db.js';
import { createApp } from './app.js';
import { startJobs } from './jobs.js';
import { attachLiveAgent } from './agent/index.js';

await connectDb();
const app = createApp();
const server = app.listen(config.port, () => {
  console.log(`Hotel API on http://localhost:${config.port}  ·  payments: ${config.paymentProvider}  ·  whatsapp: ${config.whatsapp.provider}`);
});
attachLiveAgent(server);
const stopJobs = startJobs();

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    stopJobs();
    server.close(() => process.exit(0));
  });
}
