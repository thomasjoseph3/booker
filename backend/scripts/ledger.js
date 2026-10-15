import { nightsBetween } from '../src/utils/dates.js';

/** Nights a booking currently occupies in inventory: all of them while held, otherwise those before the release point. */
export function heldNights(b) {
  if (b.inventoryHeld) return nightsBetween(b.checkIn, b.checkOut);
  if (b.inventoryReleasedFrom) return nightsBetween(b.checkIn, b.inventoryReleasedFrom);
  return [];
}
