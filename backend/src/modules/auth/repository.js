import { AdminUser } from '../../models/index.js';

export const findActiveById = async (id) => {
  const user = await AdminUser.findById(id);
  return user?.active ? user : null;
};
export const findByEmailWithPassword = (email) => AdminUser.findOne({ email: email.toLowerCase() }).select('+passwordHash');
export const findById = (id) => AdminUser.findById(id);
export const list = () => AdminUser.find().populate('hotels', 'name').sort({ createdAt: -1 });
export const create = (data) => AdminUser.create(data);
export const update = (id, changes) => AdminUser.findByIdAndUpdate(id, { $set: changes }, { returnDocument: 'after', runValidators: true });
