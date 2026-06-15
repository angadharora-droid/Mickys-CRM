const ApiError = require('../utils/ApiError');

/**
 * Validates req.body (or another source) against a Zod schema.
 * Replaces the source with the parsed (typed/stripped) value.
 */
const validate = (schema, source = 'body') => (req, _res, next) => {
  const result = schema.safeParse(req[source]);
  if (!result.success) {
    const details = result.error.issues.map(
      (i) => `${i.path.join('.') || 'value'}: ${i.message}`
    );
    return next(ApiError.badRequest('Validation failed', details));
  }
  req[source] = result.data;
  next();
};

module.exports = validate;
