// Prints a login token for the staff MCP server: npm run mcp:token -- manager@lakesidepalms.local [days]
import jwt from 'jsonwebtoken';
import mongoose from 'mongoose';
import { config } from '../src/config.js';
import { connectDb } from '../src/db.js';
import { AdminUser, Hotel } from '../src/models/index.js';

const [email, days = '30'] = process.argv.slice(2);
if (!email) {
  console.error('Usage: npm run mcp:token -- <staff email> [days, default 30]');
  process.exit(1);
}
await connectDb();
const user = await AdminUser.findOne({ email: email.toLowerCase(), active: { $ne: false } });
if (!user) {
  console.error(`No active user with email ${email}`);
  process.exit(1);
}
const token = jwt.sign({ sub: String(user._id), role: user.role }, config.jwtSecret, { expiresIn: `${Number(days)}d` });
const hotels = await Hotel.find(user.role === 'super_admin' ? {} : { _id: { $in: user.hotels } }).select('name');
console.log(`Token for ${user.email} (${user.role}), valid ${days} days. Treat it like a password.\n\n${token}\n`);
for (const h of hotels) console.log(`${h.name}:  http://localhost:${config.port}/mcp/staff/${h._id}`);
await mongoose.disconnect();
