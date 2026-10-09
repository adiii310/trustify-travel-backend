const { Schema, model } = require('mongoose');
const { baseOptions, tsField } = require('../shared/schema.helpers');

// A public question about a company, and the admin's answer
const questionSchema = new Schema({
  c: { type: String, required: true, uppercase: true, index: true }, // company short code
  n: { type: String, required: true, trim: true, maxlength: 80 }, // asker name
  q: { type: String, required: true, trim: true, maxlength: 1000 },
  a: { type: String, trim: true, maxlength: 2000, default: '' }, // answer
  status: { type: String, enum: ['open', 'answered', 'hidden'], default: 'open', index: true },
  ts: tsField,
}, baseOptions);

module.exports = model('Question', questionSchema);
