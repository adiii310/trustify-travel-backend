import { Schema, model } from 'mongoose';
import { baseOptions, tsField } from '../shared/schema.helpers.js';

/**
 * A traveller on the customer portal.
 *
 * This collection predates customer accounts: `POST /api/members` has always
 * been identity capture — a name and an email, no password, no token. That
 * endpoint still behaves exactly that way, so the records it created remain
 * valid and nothing that relied on it breaks.
 *
 * Registration **upgrades** such a record in place rather than creating a
 * second one: `POST /api/auth/customer/register` matches on email and fills in
 * the username, phone and password hash. A member with no `passwordHash`
 * simply cannot sign in yet, which is the honest state for a row captured
 * before accounts existed.
 */
const memberSchema = new Schema({
  name: { type: String, required: true, trim: true, maxlength: 80 },
  email: {
    type: String,
    required: true,
    unique: true,
    trim: true,
    lowercase: true,
    match: [/.+@.+\..+/, 'Enter a valid email.'],
  },
  /**
   * Optional login identifier. `sparse` so the unique index ignores the many
   * rows that have none — a plain unique index would reject the second
   * passwordless member ever captured.
   */
  username: {
    type: String,
    unique: true,
    sparse: true,
    trim: true,
    lowercase: true,
    minlength: 3,
    maxlength: 30,
    match: [/^[a-z0-9._-]+$/, 'Use letters, numbers, dots, dashes or underscores.'],
  },
  /** Also a login identifier, so also unique-but-sparse. Digits are normalised. */
  phone: {
    type: String,
    unique: true,
    sparse: true,
    trim: true,
    maxlength: 20,
  },
  /** bcrypt. `select: false` so it never leaves the database by accident. */
  passwordHash: { type: String, select: false },
  ts: tsField,
}, baseOptions);

/** The only shape of a member that may leave the server. */
memberSchema.methods.toPublicJSON = function toPublicJSON() {
  return {
    _id: this._id,
    name: this.name,
    email: this.email,
    username: this.username || '',
    phone: this.phone || '',
    ts: this.ts,
  };
};

export default model('Member', memberSchema);
