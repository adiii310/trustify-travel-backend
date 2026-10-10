import rateLimit from 'express-rate-limit';
import env from '../config/env.js';
import ApiError from '../utils/ApiError.js';

/**
 * Loopback addresses, for the development-only skip below.
 *
 * `trust proxy` is on, so `req.ip` is the forwarded client address in
 * production and the real socket address locally.
 */
const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);

/**
 * Whether to let this request past the limiter untouched.
 *
 * **Development only, and loopback only.** A limiter that locks a developer or
 * the test suite out of their own machine after ten sign-ins teaches people to
 * raise the limits, which is how the production budget ends up wrong. In
 * production this returns false for every request, including loopback ones, so
 * nothing can be bypassed by spoofing a local address behind a proxy.
 */
const skipLocal = (req) => !env.isProduction && LOOPBACK.has(req.ip);

// Rejections go through ApiError so a 429 looks like every other failure.
const build = ({ windowMs, limit, message }) =>
  rateLimit({
    windowMs,
    limit,
    standardHeaders: true,
    legacyHeaders: false,
    skip: skipLocal,
    handler: (req, res, next) => next(ApiError.tooManyRequests(message)),
  });

/**
 * Slows down password guessing on the two login endpoints.
 *
 * Deliberately *not* on registration: this is a credential-guessing budget,
 * and spending it on sign-ups would lock a shared office IP out of creating
 * accounts after ten of them.
 */
const loginLimiter = build({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  message: 'Too many sign-in attempts. Try again in 15 minutes.',
});

/**
 * Shared by every public form submission, counted across all of them per IP.
 * Registration belongs here: it is a public write that creates a record.
 */
const formLimiter = build({
  windowMs: 10 * 60 * 1000,
  limit: 20,
  message: 'Too many submissions. Try again in a few minutes.',
});

export { loginLimiter, formLimiter };
