import { AssistantChat } from '../../models/index.js';

export const create = (hotelId, userId) => AssistantChat.create({ hotel: hotelId, user: userId, lastMessageAt: new Date() });

export const findById = (hotelId, id) => AssistantChat.findOne({ _id: id, hotel: hotelId });

/** Chat list without the messages. `userId` limits it to one person's chats (omit to list everyone's). */
export const list = (hotelId, { userId, limit = 50 } = {}) =>
  AssistantChat.find({ hotel: hotelId, ...(userId ? { user: userId } : {}) })
    .select('-messages')
    .populate('user', 'name email')
    .sort({ lastMessageAt: -1 })
    .limit(limit);

export const setTitle = (id, title) => AssistantChat.updateOne({ _id: id }, { $set: { title } });

/** Appends messages and bumps the counters in one atomic update. */
export const appendMessages = (id, messages) =>
  AssistantChat.findByIdAndUpdate(
    id,
    { $push: { messages: { $each: messages } }, $inc: { messageCount: messages.length }, $set: { lastMessageAt: new Date() } },
    { returnDocument: 'after' },
  );

export const populateUser = (chat) => chat.populate('user', 'name email');
