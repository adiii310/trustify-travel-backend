import bcrypt from 'bcryptjs';

import Member from './member.model.js';
import { signCustomerToken } from '../../middlewares/auth.middleware.js';
import asyncHandler from '../../utils/asyncHandler.js';
import ApiResponse from '../../utils/ApiResponse.js';
import ApiError from '../../utils/ApiError.js';

const MIN_PASSWORD_LENGTH = 8;
const BCRYPT_ROUNDS = 12;

/** Digits only, so `+91 98765 43210` and `9876543210` are the same account. */
const normalisePhone = (value) => String(value || '').replace(/\D/g, '');

const EMAIL = /.+@.+\..+/;
const USERNAME = /^[a-z0-9._-]{3,30}$/;

/**
 * Validate a registration body and return the normalised fields.
 *
 * Returns every problem at once rather than the first: a form that reveals one
 * error per submit is three round trips for a single mistake-prone screen.
 */
function readRegistration(body = {}) {
  const errors = [];

  const name = String(body.name || '').trim();
  const email = String(body.email || '').trim().toLowerCase();
  const username = String(body.username || '').trim().toLowerCase();
  const phone = normalisePhone(body.phone);
  const password = String(body.password || '');

  if (!name) errors.push({ field: 'name', message: 'Enter your name.' });
  if (name.length > 80) errors.push({ field: 'name', message: 'Name is too long.' });

  if (!EMAIL.test(email)) {
    errors.push({ field: 'email', message: 'Enter a valid email address.' });
  }
  if (phone.length < 7 || phone.length > 15) {
    errors.push({ field: 'phone', message: 'Enter a valid phone number.' });
  }
  // Optional, but validated when supplied — a username is a login identifier
  // and a blank-but-present one would be a second account nobody can sign into.
  if (username && !USERNAME.test(username)) {
    errors.push({
      field: 'username',
      message: 'Username must be 3-30 characters: letters, numbers, dots, dashes or underscores.',
    });
  }
  if (password.length < MIN_PASSWORD_LENGTH) {
    errors.push({
      field: 'password',
      message: `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`,
    });
  }

  if (errors.length) {
    throw ApiError.badRequest(errors[0].message, errors);
  }

  return { name, email, username, phone, password };
}

/** The 409 a taken identifier produces, named so the form can highlight it. */
const taken = (field, label) =>
  ApiError.conflict(`That ${label} is already registered.`, [
    { field, message: 'Already registered.' },
  ]);

/**
 * POST /api/auth/customer/register
 *
 * **Upgrades an existing passwordless member rather than refusing.** The
 * `members` collection has been collecting names and emails through
 * `POST /api/members` since before accounts existed; a traveller whose email
 * is already there is the same person, and telling them "already registered"
 * when they have never set a password would lock them out of their own record.
 *
 * An email that already has a password is a genuine duplicate and is a 409.
 */
const register = asyncHandler(async (req, res) => {
  const { name, email, username, phone, password } = readRegistration(req.body);

  const existing = await Member.findOne({ email }).select('+passwordHash');
  if (existing?.passwordHash) throw taken('email', 'email address');

  // Both are unique-but-sparse, so check them against *other* records only.
  const notMe = existing ? { _id: { $ne: existing._id } } : {};
  const [usernameTaken, phoneTaken] = await Promise.all([
    username ? Member.exists({ username, ...notMe }) : null,
    Member.exists({ phone, ...notMe }),
  ]);
  if (usernameTaken) throw taken('username', 'username');
  if (phoneTaken) throw taken('phone', 'phone number');

  const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);

  const member = existing ?? new Member({ email });
  member.name = name;
  member.phone = phone;
  member.passwordHash = passwordHash;
  if (username) member.username = username;
  await member.save();

  ApiResponse.created(
    res,
    { token: signCustomerToken(member), member: member.toPublicJSON() },
    'Account created successfully',
  );
});

/**
 * POST /api/auth/customer/login
 *
 * One `identifier` field resolves to an email, a username or a phone number.
 * Which one it is is inferred from its shape rather than asked for, because a
 * traveller types what they remember.
 *
 * Every failure returns the same 401 — a wrong password, an unknown
 * identifier and an account that has never set a password are
 * indistinguishable, so this cannot be used to discover who has an account.
 */
const login = asyncHandler(async (req, res) => {
  const identifier = String(req.body?.identifier || '').trim();
  const password = String(req.body?.password || '');

  if (!identifier || !password) {
    const errors = [];
    if (!identifier) {
      errors.push({ field: 'identifier', message: 'Enter your email, username or phone.' });
    }
    if (!password) errors.push({ field: 'password', message: 'Enter your password.' });
    throw ApiError.badRequest('Enter your details to sign in.', errors);
  }

  const digits = normalisePhone(identifier);
  const query = identifier.includes('@')
    ? { email: identifier.toLowerCase() }
    // A purely numeric identifier is a phone number; anything else is a
    // username. Checking both would let a username of all digits shadow
    // someone's phone number.
    : digits.length >= 7 && digits.length === identifier.replace(/[\s+()-]/g, '').length
      ? { phone: digits }
      : { username: identifier.toLowerCase() };

  const member = await Member.findOne(query).select('+passwordHash');

  const ok =
    member?.passwordHash && (await bcrypt.compare(password, member.passwordHash));
  if (!ok) throw ApiError.unauthorized('Those details do not match an account.');

  ApiResponse.ok(
    res,
    { token: signCustomerToken(member), member: member.toPublicJSON() },
    'Signed in successfully',
  );
});

/** GET /api/auth/customer/me — who the supplied token belongs to. */
const me = asyncHandler(async (req, res) => {
  ApiResponse.ok(res, { member: req.member.toPublicJSON() }, 'Account fetched successfully');
});

/**
 * PATCH /api/auth/customer/me — update the permitted profile fields.
 *
 * `email` is deliberately absent: it is the key registration matched on and
 * the handle every historical booking was made under. Changing it is a support
 * action, not a self-service one.
 */
const updateProfile = asyncHandler(async (req, res) => {
  const member = await Member.findById(req.member._id);
  const errors = [];

  if (req.body.name !== undefined) {
    const name = String(req.body.name).trim();
    if (!name || name.length > 80) {
      errors.push({ field: 'name', message: 'Enter your name.' });
    } else {
      member.name = name;
    }
  }

  if (req.body.phone !== undefined) {
    const phone = normalisePhone(req.body.phone);
    if (phone.length < 7 || phone.length > 15) {
      errors.push({ field: 'phone', message: 'Enter a valid phone number.' });
    } else if (await Member.exists({ phone, _id: { $ne: member._id } })) {
      errors.push({ field: 'phone', message: 'Already registered.' });
    } else {
      member.phone = phone;
    }
  }

  if (req.body.username !== undefined) {
    const username = String(req.body.username).trim().toLowerCase();
    if (username && !USERNAME.test(username)) {
      errors.push({ field: 'username', message: 'Username must be 3-30 characters.' });
    } else if (username && (await Member.exists({ username, _id: { $ne: member._id } }))) {
      errors.push({ field: 'username', message: 'Already taken.' });
    } else {
      // Unset rather than store "": a unique index treats every empty string as
      // the same value and would reject the second member to clear it.
      member.username = username || undefined;
    }
  }

  if (errors.length) throw ApiError.badRequest(errors[0].message, errors);

  await member.save();
  ApiResponse.ok(res, { member: member.toPublicJSON() }, 'Profile updated successfully');
});

/**
 * POST /api/auth/customer/password — change it, proving the current one first.
 *
 * Returns a fresh token: the old one stays valid until it expires, and a
 * password change is exactly when a caller expects the session to be reissued.
 */
const changePassword = asyncHandler(async (req, res) => {
  const current = String(req.body?.currentPassword || '');
  const next = String(req.body?.newPassword || '');

  if (next.length < MIN_PASSWORD_LENGTH) {
    throw ApiError.badRequest(
      `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`,
      [{ field: 'newPassword', message: `At least ${MIN_PASSWORD_LENGTH} characters.` }],
    );
  }

  const member = await Member.findById(req.member._id).select('+passwordHash');
  const ok = member.passwordHash && (await bcrypt.compare(current, member.passwordHash));
  if (!ok) {
    throw ApiError.unauthorized('Your current password is not correct.');
  }

  member.passwordHash = await bcrypt.hash(next, BCRYPT_ROUNDS);
  await member.save();

  ApiResponse.ok(
    res,
    { token: signCustomerToken(member), member: member.toPublicJSON() },
    'Password changed successfully',
  );
});

export default { register, login, me, updateProfile, changePassword };
export { normalisePhone, MIN_PASSWORD_LENGTH };
