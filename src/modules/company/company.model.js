const { Schema, model } = require('mongoose');
const { baseOptions, tsField, visibilityField } = require('../shared/schema.helpers');

// A verified travel company shown on the customer portal
const companySchema = new Schema({
  k: { type: String, required: true, unique: true, uppercase: true, trim: true, maxlength: 3 }, // short code / logo letter
  name: { type: String, required: true, trim: true, maxlength: 120 },
  score: { type: Number, required: true, min: 0, max: 100 }, // trust score
  rating: { type: Number, default: 0, min: 0, max: 5 },
  dests: { type: Number, default: 0, min: 0 }, // destinations covered
  since: { type: String, trim: true, default: '' }, // "Jan 2023"
  city: { type: String, trim: true, default: '' },
  exp: { type: Number, default: 0, min: 0 }, // years in business
  price: { type: Number, default: 0, min: 0 }, // 3N/4D price per person (INR)
  reviews: { type: Number, default: 0, min: 0 }, // verified review count
  tags: [{ type: String, trim: true, maxlength: 40 }],
  featured: { type: Boolean, default: false, index: true }, // homepage "Top Rated Companies"
  featuredRank: { type: Number, default: 0, min: 0 }, // ascending; ties fall back to score
  status: visibilityField,
  ts: tsField,
}, baseOptions);

module.exports = model('Company', companySchema);
