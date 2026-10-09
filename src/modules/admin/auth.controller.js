const bcrypt = require('bcryptjs');
const Admin = require('./admin.model');
const { signToken } = require('../../middlewares/auth.middleware');
const asyncHandler = require('../../utils/asyncHandler');
const ApiResponse = require('../../utils/ApiResponse');
const ApiError = require('../../utils/ApiError');

/**
 * POST /api/auth/login
 * An unknown email and a wrong password return the same message, so the
 * endpoint cannot be used to find out which accounts exist.
 */
const login = asyncHandler(async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) throw ApiError.badRequest('Enter your email and password.');

  const admin = await Admin.findOne({ email: String(email).toLowerCase().trim() }).select('+passwordHash');
  if (!admin || !(await bcrypt.compare(String(password), admin.passwordHash))) {
    throw ApiError.unauthorized('Email or password is incorrect.');
  }

  ApiResponse.ok(res, { token: signToken(admin), admin: admin.toPublicJSON() }, 'Signed in successfully');
});

/** GET /api/auth/me — who the supplied token belongs to. */
const me = asyncHandler(async (req, res) => {
  ApiResponse.ok(res, { admin: req.admin.toPublicJSON() }, 'Admin fetched successfully');
});

module.exports = { login, me };
