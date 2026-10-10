import jwt from 'jsonwebtoken';
import env from '../config/env.js';
import ApiError from '../utils/ApiError.js';
import asyncHandler from '../utils/asyncHandler.js';
import Admin from '../modules/admin/admin.model.js';
import Member from '../modules/member/member.model.js';

/**
 * Two audiences share one signing secret, so every token carries a `typ` and
 * every guard checks it.
 *
 * Without that claim a customer token and an admin token are structurally
 * identical, and the only thing standing between them is that a Member `_id`
 * happens not to exist in the Admin collection. That is an accident, not a
 * boundary — `typ` makes it an explicit one, checked before any lookup.
 */
const TOKEN_TYPES = { admin: 'admin', customer: 'customer' };

const sign = (typ, sub, extra = {}) =>
  jwt.sign({ sub: String(sub), typ, ...extra }, env.JWT_SECRET, {
    expiresIn: env.JWT_EXPIRES_IN,
  });

/** Issue a token for a signed-in admin. */
const signToken = (admin) => sign(TOKEN_TYPES.admin, admin._id, { role: admin.role });

/** Issue a token for a signed-in customer. */
const signCustomerToken = (member) => sign(TOKEN_TYPES.customer, member._id);

/** Read and verify the bearer token, or throw the standard 401. */
function readToken(req) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) throw ApiError.unauthorized('Sign in to continue.');

  try {
    return jwt.verify(token, env.JWT_SECRET);
  } catch {
    throw ApiError.unauthorized('Your session expired. Sign in again.');
  }
}

/** Guard for every /api/admin route and GET /api/auth/me. Sets req.admin. */
const requireAdmin = asyncHandler(async (req, res, next) => {
  const payload = readToken(req);

  // A customer token must never satisfy an admin guard, whatever its `sub`.
  if (payload.typ === TOKEN_TYPES.customer) {
    throw ApiError.forbidden('This area is for administrators.');
  }

  const admin = await Admin.findById(payload.sub);
  if (!admin) throw ApiError.unauthorized('This account no longer exists.');

  req.admin = admin;
  next();
});

/**
 * Guard for every customer-owned route. Sets `req.member`.
 *
 * The member is re-read on each request, so an account deleted mid-session
 * stops working immediately rather than at token expiry. Every customer
 * endpoint derives identity from `req.member._id` and never from the body —
 * which is what stops one customer reading another's bookings.
 */
const requireCustomer = asyncHandler(async (req, res, next) => {
  const payload = readToken(req);

  if (payload.typ !== TOKEN_TYPES.customer) {
    throw ApiError.unauthorized('Sign in to continue.');
  }

  const member = await Member.findById(payload.sub);
  if (!member) throw ApiError.unauthorized('This account no longer exists.');

  req.member = member;
  next();
});

export { signToken, signCustomerToken, requireAdmin, requireCustomer, TOKEN_TYPES };
