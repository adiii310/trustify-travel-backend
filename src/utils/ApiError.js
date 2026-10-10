/**
 * The single failure envelope for every endpoint.
 *
 *   { success: false, statusCode: 404, message: "…", errors: [] }
 *
 * Throw one from anywhere — asyncHandler forwards it to the error middleware,
 * which serialises it. `message` is always safe to show an end user; anything
 * unexpected is converted to a generic 500 before it reaches the client.
 *
 *   throw ApiError.notFound('Record not found.');
 *   throw ApiError.badRequest('Pick a company to review.');
 */
class ApiError extends Error {
  constructor(statusCode = 500, message = 'Something went wrong on the server.', errors = []) {
    super(message);
    this.name = 'ApiError';
    this.success = false;
    this.statusCode = statusCode;
    this.errors = errors; // optional per-field details, e.g. [{ field, message }]
    this.isOperational = true; // expected failure: safe to send `message` as-is
    Error.captureStackTrace(this, this.constructor);
  }

  toJSON() {
    return {
      success: false,
      statusCode: this.statusCode,
      message: this.message,
      errors: this.errors,
    };
  }

  static badRequest(message = 'The request could not be processed.', errors = []) {
    return new ApiError(400, message, errors);
  }

  static unauthorized(message = 'Sign in to continue.') {
    return new ApiError(401, message);
  }

  static forbidden(message = 'You do not have access to this.') {
    return new ApiError(403, message);
  }

  static notFound(message = 'Record not found.') {
    return new ApiError(404, message);
  }

  static conflict(message = 'That value is already in use.', errors = []) {
    return new ApiError(409, message, errors);
  }

  static tooManyRequests(message = 'Too many requests. Try again shortly.') {
    return new ApiError(429, message);
  }

  static internal(message = 'Something went wrong on the server.') {
    return new ApiError(500, message);
  }
}

export default ApiError;
