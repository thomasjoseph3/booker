import { ApiError } from '../utils/errors.js';

export const validate = (schema, where = 'body') => (req, res, next) => {
  const result = schema.safeParse(where === 'body' ? req.body ?? {} : req.query);
  if (!result.success) {
    throw new ApiError(
      400,
      'VALIDATION_ERROR',
      result.error.issues.map((i) => `${i.path.join('.') || 'body'}: ${i.message}`).join('; '),
      result.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
    );
  }
  if (where === 'body') req.body = result.data;
  else req.q = result.data; // req.query is read-only in Express 5
  next();
};

// For PATCH: validate against the partial schema but keep only keys the client sent,
// so schema defaults never overwrite stored values.
export const validatePatch = (schema) => (req, res, next) => {
  const raw = req.body ?? {};
  validate(schema.partial())(req, res, () => {
    req.body = Object.fromEntries(Object.entries(req.body).filter(([k]) => Object.hasOwn(raw, k)));
    next();
  });
};
