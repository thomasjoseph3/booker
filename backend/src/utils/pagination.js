import { z } from 'zod';

/** Query-string schema shared by every paginated admin list. */
export const pageQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

/**
 * Runs a paginated query. `q` is a parsed pageQuery.
 * @returns {Promise<{items: object[], total: number, page: number, pages: number}>}
 */
export async function paginate(model, filter, q, { sort = { createdAt: -1 }, populate, select } = {}) {
  let query = model
    .find(filter)
    .sort(sort)
    .skip((q.page - 1) * q.limit)
    .limit(q.limit);
  if (populate) query = query.populate(...populate);
  if (select) query = query.select(select);
  const [items, total] = await Promise.all([query, model.countDocuments(filter)]);
  return { items, total, page: q.page, pages: Math.ceil(total / q.limit) };
}
