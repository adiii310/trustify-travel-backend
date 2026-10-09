const { Schema, model } = require('mongoose');
const { baseOptions, tsField, visibilityField } = require('../shared/schema.helpers');

// A headline figure in the customer homepage hero strip.
//
// `value` is admin-entered display text, not a computed count: the site shows
// rounded, marketing-friendly figures ("450+", "50,000+") that deliberately do
// not track the row counts in this database.
const metricSchema = new Schema({
  icon: { type: String, trim: true, default: '', maxlength: 16 }, // emoji, e.g. "🏢"
  value: { type: String, required: true, trim: true, maxlength: 20 }, // "450+"
  label: { type: String, required: true, trim: true, maxlength: 60 }, // "Verified Companies"
  order: { type: Number, default: 0, min: 0 }, // ascending; ties fall back to ts
  status: visibilityField,
  ts: tsField,
}, baseOptions);

module.exports = model('Metric', metricSchema);
