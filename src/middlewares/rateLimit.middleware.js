const rateLimit = require('express-rate-limit');
const ApiError = require('../utils/ApiError');

// Rejections go through ApiError so a 429 looks like every other failure.
const build = ({ windowMs, limit, message }) =>
  rateLimit({
    windowMs,
    limit,
    standardHeaders: true,
    legacyHeaders: false,
    handler: (req, res, next) => next(ApiError.tooManyRequests(message)),
  });

/** Slows down password guessing on POST /api/auth/login. */
const loginLimiter = build({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  message: 'Too many sign-in attempts. Try again in 15 minutes.',
});

/** Shared by every public form submission, counted across all of them per IP. */
const formLimiter = build({
  windowMs: 10 * 60 * 1000,
  limit: 20,
  message: 'Too many submissions. Try again in a few minutes.',
});

module.exports = { loginLimiter, formLimiter };
