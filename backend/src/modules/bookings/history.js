import { round2 } from '../../utils/misc.js';

/** One entry of a booking's audit trail. `actor` is `{ label }` or null for the system. */
export const histEntry = (action, actor, note) => ({ at: new Date(), action, by: actor?.label || 'system', note });

/** Money kept so far: payments received minus refunds. */
export const netPaid = (booking) => round2((booking.amountPaid || 0) - (booking.amountRefunded || 0));
