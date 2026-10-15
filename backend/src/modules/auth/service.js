import bcrypt from 'bcryptjs';
import { signToken } from '../../middleware/auth.js';
import { notFound, unauthorized } from '../../utils/errors.js';
import * as repo from './repository.js';

const publicUser = (u) => ({ id: u._id, name: u.name, email: u.email, role: u.role, hotels: u.hotels });

export async function login(email, password) {
  const user = await repo.findByEmailWithPassword(email);
  if (!user || !user.active || !(await bcrypt.compare(password, user.passwordHash))) throw unauthorized('Invalid email or password');
  user.lastLoginAt = new Date();
  await user.save();
  return { token: signToken(user), user: publicUser(user) };
}

export const describeUser = publicUser;

export async function createUser({ password, ...data }) {
  const user = await repo.create({ ...data, passwordHash: await bcrypt.hash(password, 10) });
  return repo.findById(user._id);
}

export async function updateUser(id, { password, ...changes }) {
  const update = { ...changes };
  if (password) update.passwordHash = await bcrypt.hash(password, 10);
  const user = await repo.update(id, update);
  if (!user) throw notFound('User');
  return user;
}

export const listUsers = repo.list;
