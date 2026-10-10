import env from '../config/env.js';
import ApiError from '../utils/ApiError.js';

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
  // Multer rejects an oversized or unexpected upload before the handler runs.
  if (err.name === 'MulterError') {
    const message = err.code === 'LIMIT_FILE_SIZE'
      ? 'That image is too large. The limit is 5 MB.'
      : 'That upload could not be read. Send one image in a field named "image".';
    return ApiError.badRequest(message, [{ field: err.field || 'image', message }]);
  }

  // Unexpected: log it in full, tell the client nothing about the internals.
  return ApiError.internal();
}

// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
  const apiError = toApiError(err);

  // A deliberately thrown ApiError is an outcome a handler chose, even at 5xx —
  // `503 image uploads are not configured` is not a crash. Only genuinely
  // unexpected failures are logged in full and carry a stack back to the client.
  const unexpected = !(err instanceof ApiError) && apiError.statusCode >= 500;
  if (unexpected) console.error(err);

  const body = apiError.toJSON();
  if (!env.isProduction && unexpected) body.stack = err.stack;

  res.status(apiError.statusCode).json(body);
}

export { notFound, errorHandler };
