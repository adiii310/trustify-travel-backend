import { Schema, model } from 'mongoose';
import { baseOptions, tsField, visibilityField } from '../shared/schema.helpers.js';

// A verified travel company shown on the customer portal
const companySchema = new Schema({
  k: { type: String, required: true, unique: true, uppercase: true, trim: true, maxlength: 3 }, // short code / logo letter
  name: { type: String, required: true, trim: true, maxlength: 120 },
  score: { type: Number, required: true, min: 0, max: 100 }, // trust score
  rating: { type: Number, default: 0, min: 0, max: 5 },
  dests: { type: Number, default: 0, min: 0 }, // destinations covered — a display figure
  // Which destinations this company actually runs trips to, as destination
  // slugs. This is the join the destination detail page filters on; `dests`
  // above is only the headline number shown on a company card, and the two are
  // not kept in sync for you.
  places: [{ type: String, lowercase: true, trim: true, maxlength: 80 }],
  since: { type: String, trim: true, default: '' }, // "Jan 2023"
  city: { type: String, trim: true, default: '' },
  exp: { type: Number, default: 0, min: 0 }, // years in business
  price: { type: Number, default: 0, min: 0 }, // 3N/4D price per person (INR)
  reviews: { type: Number, default: 0, min: 0 }, // verified review count
  tags: [{ type: String, trim: true, maxlength: 40 }],
  // Profile content the customer site renders verbatim. Empty is a real answer:
  // the site hides the section rather than inventing copy for it.
  about: { type: String, trim: true, default: '', maxlength: 3000 },
  // Per-parameter trust scores behind the headline `score`. Any length — the
  // site renders whatever is here, so dropping to 6 parameters needs no change.
  breakdown: [{
    _id: false,
    label: { type: String, required: true, trim: true, maxlength: 60 },
    score: { type: Number, required: true, min: 0, max: 100 },
  }],
  docs: [{ type: String, trim: true, maxlength: 120 }], // verified documents
  policies: [{
    _id: false,
    label: { type: String, required: true, trim: true, maxlength: 60 },
    value: { type: String, required: true, trim: true, maxlength: 300 },
  }],
  photos: [{ type: String, trim: true, maxlength: 500 }], // hosted image URLs
  featured: { type: Boolean, default: false, index: true }, // homepage "Top Rated Companies"
  featuredRank: { type: Number, default: 0, min: 0 }, // ascending; ties fall back to score
  status: visibilityField,
  ts: tsField,
}, baseOptions);

export default model('Company', companySchema);
