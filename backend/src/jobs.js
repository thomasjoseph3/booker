import { config } from './config.js';
import { expireHolds } from './services/bookings.js';

// Single-instance sweeper. With several API instances, run this in one worker (or use a scheduler).
export function startJobs() {
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      const n = await expireHolds();
      if (n) console.log(`[jobs] expired ${n} unpaid booking hold(s)`);
    } catch (e) {
      console.error('[jobs] expireHolds failed', e);
    } finally {
      running = false;
    }
  };
  const timer = setInterval(tick, config.holdSweepSeconds * 1000);
  tick();
  return () => clearInterval(timer);
}
