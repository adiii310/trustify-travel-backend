const { Schema, model } = require('mongoose');
const { baseOptions, tsField, visibilityField } = require('../shared/schema.helpers');

// A destination page on the customer portal
const destinationSchema = new Schema({
  slug: { type: String, required: true, unique: true, lowercase: true, trim: true },
  name: { type: String, required: true, trim: true },
  region: { type: String, default: 'India' },
  n: { type: Number, default: 0, min: 0 }, // number of verified companies
  rating: { type: Number, default: 0, min: 0, max: 5 },
  desc: { type: String, default: '' },
  best: String,
  diff: String,
  dur: String,
  budget: String,
  c1: { type: String, default: '#2b4463' }, // card gradient start
  c2: { type: String, default: '#0a1424' }, // card gradient end
  status: visibilityField,
  ts: tsField,
}, baseOptions);

module.exports = model('Destination', destinationSchema);
