import { config } from './config.js';
import { expireHolds } from './modules/bookings/service.js';
import { closeStaleCalls } from './modules/calls/service.js';
import { releaseStaleCleaning } from './modules/rooms/service.js';

// Single-instance sweeper. With several API instances, run this in one worker (or use a scheduler).
export function startJobs() {
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      const n = await expireHolds();
      if (n) console.log(`[jobs] expired ${n} unpaid booking hold(s)`);
      const clean = await releaseStaleCleaning(config.cleaningMaxHours);
      if (clean) console.log(`[jobs] ${clean} room(s) were on cleaning for over ${config.cleaningMaxHours}h, now available`);
      const stale = await closeStaleCalls(config.gemini.maxLiveMinutes + 5);
      if (stale) console.log(`[jobs] closed ${stale} call(s) left open`);
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
