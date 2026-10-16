import { Router } from 'express';
import { staffAssistantRoutes } from '../agent/index.js';
import { loadHotelParam, requireAdmin } from '../middleware/auth.js';
import analytics from '../modules/analytics/routes.js';
import { accountRouter, loginRouter } from '../modules/auth/routes.js';
import bookings from '../modules/bookings/routes.js';
import calls from '../modules/calls/routes.js';
import guests from '../modules/guests/routes.js';
import hotels from '../modules/hotels/routes.js';
import inventory from '../modules/inventory/routes.js';
import notifications from '../modules/notifications/routes.js';
import payments from '../modules/payments/adminRoutes.js';
import offers from '../modules/offers/routes.js';
import rooms from '../modules/rooms/routes.js';

/**
 * The admin API (/api/admin), used by the Next.js dashboard.
 * Everything except login needs a bearer token; routes under /hotels/:hotelId are also
 * checked against the user's property access (see loadHotelParam).
 */
const router = Router();

router.use(loginRouter);
router.use(requireAdmin);
router.use(accountRouter);
router.param('hotelId', loadHotelParam);
router.use(hotels);

const scoped = Router({ mergeParams: true });
for (const feature of [analytics, rooms, offers, inventory, bookings, payments, guests, calls, notifications, staffAssistantRoutes])
  scoped.use(feature);
router.use('/hotels/:hotelId', scoped);

export default router;
