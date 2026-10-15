import { Hotel } from '../../models/index.js';

export const findById = (id) => Hotel.findById(id);

export const findActiveBySlug = (slug) => Hotel.findOne({ slug: String(slug).toLowerCase(), active: true });

/** Accepts a hotel id or slug (slugs stay stable across re-seeds and environments). */
export const findActiveByRef = (ref) => {
  const isId = /^[a-f\d]{24}$/i.test(ref);
  return Hotel.findOne({ ...(isId ? { _id: ref } : { slug: String(ref).toLowerCase() }), active: true });
};

export const findActiveByAgentKeyHash = (hash) => Hotel.findOne({ 'agent.apiKeyHash': hash, active: true });

export const findActiveByPhoneNumber = (number) => Hotel.findOne({ phoneNumbers: number, active: true });

export const list = (filter = {}) => Hotel.find(filter).sort({ name: 1 });

export const create = (data) => Hotel.create(data);

export const setAgentKey = (id, hash, preview) =>
  Hotel.updateOne({ _id: id }, { $set: { 'agent.apiKeyHash': hash, 'agent.apiKeyPreview': preview } });
