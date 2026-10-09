const jwt = require('jsonwebtoken');
const env = require('../config/env');
const ApiError = require('../utils/ApiError');
const asyncHandler = require('../utils/asyncHandler');
const Admin = require('../modules/admin/admin.model');

/** Issue a token for a signed-in admin. */
const signToken = (admin) =>
  jwt.sign({ sub: admin._id.toString(), role: admin.role }, env.JWT_SECRET, {
    expiresIn: env.JWT_EXPIRES_IN,
  });

/** Guard for every /api/admin route and GET /api/auth/me. Sets req.admin. */
const requireAdmin = asyncHandler(async (req, res, next) => {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) throw ApiError.unauthorized('Sign in to continue.');

  let payload;
  try {
    payload = jwt.verify(token, env.JWT_SECRET);
  } catch {
    throw ApiError.unauthorized('Your session expired. Sign in again.');
  }

  const admin = await Admin.findById(payload.sub);
  if (!admin) throw ApiError.unauthorized('This account no longer exists.');

  req.admin = admin;
  next();
});

module.exports = { signToken, requireAdmin };
