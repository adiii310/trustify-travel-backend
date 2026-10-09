const { Schema, model } = require('mongoose');
const { baseOptions } = require('../shared/schema.helpers');

// An admin account. Created with `npm run create-admin`, never over the API.
const adminSchema = new Schema({
  name: { type: String, required: true, trim: true },
  email: { type: String, required: true, unique: true, trim: true, lowercase: true },
  passwordHash: { type: String, required: true, select: false }, // never returned
  role: { type: String, enum: ['admin', 'editor'], default: 'admin' },
}, baseOptions);

/** The only shape of an admin that may leave the server. */
adminSchema.methods.toPublicJSON = function toPublicJSON() {
  return { _id: this._id, name: this.name, email: this.email, role: this.role };
};

module.exports = model('Admin', adminSchema);
