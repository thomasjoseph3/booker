import mongoose from 'mongoose';
import { config } from './config.js';
import * as models from './models/index.js';

export async function connectDb(uri = config.mongoUri) {
  await mongoose.connect(uri);
  await Promise.all(Object.values(models).filter((m) => m?.syncIndexes).map((m) => m.syncIndexes()));
  return mongoose.connection;
}
