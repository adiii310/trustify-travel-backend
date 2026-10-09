const { Schema, model } = require('mongoose');
const { baseOptions, tsField } = require('../shared/schema.helpers');

// A traveller who signed in on the customer portal
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
  ts: tsField,
}, baseOptions);

module.exports = model('Member', memberSchema);
