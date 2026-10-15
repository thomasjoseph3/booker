import { Callback, CallLog } from '../../models/index.js';
import { paginate } from '../../utils/pagination.js';

// ---------- call logs ----------

export const listCalls = (hotelId, { outcome }, page) =>
  paginate(CallLog, { hotel: hotelId, ...(outcome ? { outcome } : {}) }, page, {
    select: '-transcript',
    populate: ['bookings', 'code status'],
  });

export const findCall = (hotelId, id) =>
  CallLog.findOne({ _id: id, hotel: hotelId }).populate('bookings', 'code status checkIn checkOut').populate('guest');

export const findCallByCallId = (hotelId, callId) => CallLog.findOne({ hotel: hotelId, callId });

export const createCall = (data) => CallLog.create(data);

export const appendTranscript = (hotelId, callId, entries) =>
  CallLog.updateOne({ hotel: hotelId, callId }, { $push: { transcript: { $each: entries } } });

/** Creates or updates a call record (used by external agent runtimes that report calls). */
export const upsertCall = (hotelId, callId, update) =>
  CallLog.findOneAndUpdate({ hotel: hotelId, callId }, update, { upsert: true, returnDocument: 'after' });

export const updateCall = (hotelId, callId, update) =>
  CallLog.findOneAndUpdate({ hotel: hotelId, callId }, update, { returnDocument: 'after' });

export const addBookingToCall = (hotelId, callId, bookingId) =>
  CallLog.updateOne({ hotel: hotelId, callId }, { $addToSet: { bookings: bookingId } });

/**
 * Closes calls that started before `cutoff` and never ended (the server restarted or the connection died
 * mid-call), noting why in the transcript. Returns how many were closed.
 */
export async function closeStaleCalls(cutoff, now = new Date()) {
  const result = await CallLog.updateMany(
    { endedAt: { $exists: false }, startedAt: { $lt: cutoff } },
    [
      {
        $set: {
          endedAt: now,
          durationSec: { $round: [{ $divide: [{ $subtract: [now, '$startedAt'] }, 1000] }, 0] },
          outcome: { $ifNull: ['$outcome', 'abandoned'] },
          transcript: {
            $concatArrays: [
              '$transcript',
              [{ role: 'system', text: '⚠ Call ended unexpectedly (server restart or lost connection).', at: now }],
            ],
          },
        },
      },
    ],
    { updatePipeline: true },
  );
  return result.modifiedCount;
}

export const callsForGuest = (hotelId, guest) =>
  CallLog.find({ hotel: hotelId, $or: [{ guest: guest._id }, { fromNumber: guest.phone }] })
    .select('-transcript')
    .sort({ createdAt: -1 })
    .limit(50);

export const callsForBooking = (bookingId) => CallLog.find({ bookings: bookingId }).select('callId fromNumber summary outcome createdAt');

// ---------- callbacks (tasks for staff) ----------

export const listCallbacks = (hotelId, { status }, page) =>
  paginate(Callback, { hotel: hotelId, ...(status ? { status: { $in: status.split(',') } } : {}) }, page, {
    populate: ['booking', 'code status'],
  });

export const updateCallback = (hotelId, id, changes) =>
  Callback.findOneAndUpdate({ _id: id, hotel: hotelId }, { $set: changes }, { returnDocument: 'after' });

export const createCallback = (data) => Callback.create(data);
