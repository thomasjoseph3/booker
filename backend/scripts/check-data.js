// Sanity checks for the current database: no overbooking and inventory matches bookings.
import mongoose from 'mongoose';
import { connectDb } from '../src/db.js';
import { Booking, Hotel, Inventory, RoomType } from '../src/models/index.js';
import { heldNights } from './ledger.js';

await connectDb();
let problems = 0;
for (const hotel of await Hotel.find()) {
  const rts = new Map((await RoomType.find({ hotel: hotel._id })).map((r) => [String(r._id), r]));
  const expected = new Map();
  for (const b of await Booking.find({ hotel: hotel._id })) {
    for (const d of heldNights(b)) expected.set(`${b.roomType}:${d}`, (expected.get(`${b.roomType}:${d}`) || 0) + b.roomsCount);
  }
  for (const row of await Inventory.find({ hotel: hotel._id })) {
    const rt = rts.get(String(row.roomType));
    if (row.booked > rt.totalRooms) {
      problems += 1;
      console.log(`OVERBOOKED ${hotel.name} ${rt.name} ${row.date}: ${row.booked}/${rt.totalRooms}`);
    }
    if (row.booked !== (expected.get(`${row.roomType}:${row.date}`) || 0)) {
      problems += 1;
      console.log(`DRIFT ${hotel.name} ${rt.name} ${row.date}: ${row.booked} vs ${expected.get(`${row.roomType}:${row.date}`) || 0}`);
    }
  }
  console.log(`${hotel.name}: checked`);
}
console.log(problems ? `${problems} problem(s)` : 'OK: no overbooking, inventory matches bookings');
await mongoose.disconnect();
process.exit(problems ? 1 : 0);
