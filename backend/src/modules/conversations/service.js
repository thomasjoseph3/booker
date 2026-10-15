import { forbidden, notFound } from '../../utils/errors.js';
import * as repo from './repository.js';

const MANAGER_ROLES = ['super_admin', 'hotel_admin'];
const MAX_MESSAGES = 200;

/** Front-desk staff see their own chats; managers can see everyone's at the property (for support and debugging). */
const canSeeAll = (user) => MANAGER_ROLES.includes(user.role);

export const startChat = (hotel, user) => repo.create(hotel._id, user._id);

export const listChats = (hotel, user, { all = false } = {}) =>
  repo.list(hotel._id, { userId: all && canSeeAll(user) ? undefined : user._id });

/** Loads a chat the user is allowed to see. */
export async function getChat(hotel, user, id) {
  const chat = await repo.findById(hotel._id, id);
  if (!chat) throw notFound('Conversation');
  if (!canSeeAll(user) && String(chat.user) !== String(user._id)) throw forbidden('This conversation belongs to someone else');
  return repo.populateUser(chat);
}

/** Only the owner may add to a conversation, and conversations are capped so they stay usable. */
export async function getWritableChat(hotel, user, id) {
  const chat = await getChat(hotel, user, id);
  if (String(chat.user._id ?? chat.user) !== String(user._id)) throw forbidden('You can read this conversation but not add to it');
  if (chat.messageCount >= MAX_MESSAGES) throw forbidden('This conversation is full. Start a new one.');
  return chat;
}

export async function recordExchange(chat, messages) {
  if (chat.title === 'New conversation') {
    const first = messages.find((m) => m.role === 'user');
    if (first) await repo.setTitle(chat._id, first.text.length > 60 ? `${first.text.slice(0, 57)}…` : first.text);
  }
  return repo.appendMessages(chat._id, messages);
}
