const env = require('../config/env');
const ApiError = require('../utils/ApiError');

/** Anything under /api that matched no route. */
function notFound(req, res, next) {
  next(new ApiError(404, `No route for ${req.method} ${req.originalUrl}`));
}

/** Translate framework / Mongoose failures into an ApiError we can show a user. */
function toApiError(err) {
  if (err instanceof ApiError) return err;

  if (err.name === 'ValidationError') {
    const errors = Object.values(err.errors).map((e) => ({ field: e.path, message: e.message }));
    return ApiError.badRequest(errors.map((e) => e.message).join(' '), errors);
  }
  if (err.name === 'CastError') {
    return ApiError.badRequest(`Invalid ${err.path}: ${err.value}`, [{ field: err.path, message: 'Invalid value.' }]);
  }
  if (err.code === 11000) {
    const field = Object.keys(err.keyValue || {})[0] || 'value';
    return ApiError.conflict(`That ${field} is already in use.`, [{ field, message: 'Already in use.' }]);
  }
  if (err.type === 'entity.parse.failed') {
    return ApiError.badRequest('Request body is not valid JSON.');
  }
  if (err.type === 'entity.too.large') {
    return ApiError.badRequest('Request body is too large. The limit is 100 KB.');
  }

  // Unexpected: log it in full, tell the client nothing about the internals.
  return ApiError.internal();
}

// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
  const apiError = toApiError(err);
  if (apiError.statusCode >= 500) console.error(err);

  const body = apiError.toJSON();
  if (!env.isProduction && apiError.statusCode >= 500) body.stack = err.stack;

  res.status(apiError.statusCode).json(body);
}

module.exports = { notFound, errorHandler };
